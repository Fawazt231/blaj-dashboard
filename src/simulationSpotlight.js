import { runPlayoffSimulation } from './playoffSimulatorEngine.js';
import { collectCompletedWeeklyScores } from './simulationInputs.js';
import { SIMULATION_MODEL } from './simulationModelConfig.js';

const cache = new Map();
const pct = (hits, total) => total ? hits / total * 100 : 0;
const twoRateZ = (hitsA, totalA, hitsB, totalB) => {
  if (!totalA || !totalB) return 0;
  const pooled = (hitsA + hitsB) / (totalA + totalB);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  return standardError ? Math.abs(hitsA / totalA - hitsB / totalB) / standardError : 0;
};
const seededRandom = seed => {
  let state = Number(seed) >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

export function buildSimulationSpotlight({ liveData, excelData, simulations = 10000 }) {
  const currentWeek = Number(liveData?.current_week || 1);
  const completedScores = collectCompletedWeeklyScores(liveData?.matchups_by_week, currentWeek);
  const proxies = excelData?.PerManagerSummary || [];
  const teams = (liveData?.standings || []).map(team => {
    const proxy = proxies.find(item => item.manager === team.canonical_name);
    return {
      name: team.canonical_name,
      display: team.team_name || team.canonical_name,
      rank: Number(team.rank || 99),
      wins: Number(team.wins || 0),
      losses: Number(team.losses || 0),
      fpts: Number(team.points_for || 0),
      division: team.division || 1,
      weeklyScores: completedScores[team.canonical_name] || [],
      historicalAvg: proxy ? Math.max(100, Number(proxy.highest_score || 0) * 0.7) : 110
    };
  });
  const schedule = [];
  Object.entries(liveData?.matchups_by_week || {}).forEach(([weekKey, pairs]) => {
    const week = Number(weekKey);
    if (week < currentWeek) return;
    (pairs || []).forEach(pair => {
      const away = pair?.[0]?.team_info?.canonical_name;
      const home = pair?.[1]?.team_info?.canonical_name;
      if (away && home) schedule.push({ week, away, home });
    });
  });
  schedule.sort((a, b) => a.week - b.week);
  if (!teams.length || !schedule.length) return null;
  const signature = JSON.stringify({ currentWeek, simulations, teams: teams.map(team => [team.name, team.wins, team.losses, team.fpts, team.weeklyScores]), schedule });
  if (cache.has(signature)) return cache.get(signature);

  const stats = new Map(teams.map(team => [team.name, {
    team,
    playoff: 0,
    games: new Map()
  }]));
  runPlayoffSimulation({
    teams,
    remainingSchedule: schedule.map(game => [game.away, game.home]),
    simulations,
    model: 'Bayesian',
    priorStd: SIMULATION_MODEL.priorStd,
    minSigma: SIMULATION_MODEL.minSigma,
    scoreModel: SIMULATION_MODEL.scoreModel,
    weeklySigma: SIMULATION_MODEL.weeklySigma,
    volatilityPriorGames: SIMULATION_MODEL.volatilityPriorGames,
    divisions: liveData?.divisions || {},
    rng: seededRandom((Number(liveData?.season || 0) * 1000 + currentWeek) >>> 0),
    onTrial: trial => {
      stats.forEach((stat, name) => {
        const madePlayoffs = trial.playoffField.some(team => team.name === name);
        if (madePlayoffs) stat.playoff += 1;
      });
      trial.gameResults.forEach(game => {
        [game.away, game.home].forEach(name => {
          const stat = stats.get(name);
          if (!stat) return;
          const won = game.winner === name;
          const madePlayoffs = trial.playoffField.some(team => team.name === name);
          const gameStat = stat.games.get(game.index) || { wins: 0, losses: 0, playoffAfterWin: 0, playoffAfterLoss: 0 };
          if (won) {
            gameStat.wins += 1;
            if (madePlayoffs) gameStat.playoffAfterWin += 1;
          } else {
            gameStat.losses += 1;
            if (madePlayoffs) gameStat.playoffAfterLoss += 1;
          }
          stat.games.set(game.index, gameStat);
        });
      });
    }
  });

  const candidates = [];
  stats.forEach((stat, name) => {
    const playoffPct = pct(stat.playoff, simulations);
    stat.games.forEach((game, index) => {
      // The report's spotlight is actionable only when it refers to the game
      // managers are about to play. Later-week leverage belongs in the full
      // Simulation Explorer, not the weekly preview.
      if (schedule[index]?.week !== currentWeek) return;
      if (game.wins < 500 || game.losses < 500) return;
      const afterWin = pct(game.playoffAfterWin, game.wins);
      const afterLoss = pct(game.playoffAfterLoss, game.losses);
      const difference = afterWin - afterLoss;
      const zScore = twoRateZ(game.playoffAfterWin, game.wins, game.playoffAfterLoss, game.losses);
      if (Math.abs(difference) < 8 || zScore < 3.5 || playoffPct < 5 || playoffPct > 95) return;
      const opponent = schedule[index]?.away === name ? schedule[index]?.home : schedule[index]?.away;
      const opponentDisplay = stats.get(opponent)?.team.display || opponent;
      candidates.push({
        kind: 'leverage',
        score: 120 + Math.abs(difference) - (schedule[index]?.week - currentWeek) * 2,
        text: `${stat.team.display}'s Week ${schedule[index]?.week} game against ${opponentDisplay} is its biggest playoff lever: ${afterWin.toFixed(1)}% after a win versus ${afterLoss.toFixed(1)}% after a loss.`
      });
    });
  });
  const result = candidates.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))[0] || null;
  cache.set(signature, result);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return result;
}
