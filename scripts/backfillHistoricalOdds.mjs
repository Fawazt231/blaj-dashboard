import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPlayoffSimulation } from '../src/playoffSimulatorEngine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const history = JSON.parse(await fs.readFile(path.join(root, 'public/data/excel_history.json'), 'utf8'));
const discovery = JSON.parse(await fs.readFile(path.join(root, 'data_discovery.json'), 'utf8'));
const managers = JSON.parse(await fs.readFile(path.join(root, 'managers.json'), 'utf8'));
const simulations = Number(process.env.BACKTEST_SIMULATIONS || 10000);

const canonicalByUserId = new Map(Object.entries(managers.users).map(([id, value]) => [id, value.canonical_name]));
const seededRandom = seed => {
  let state = Number(seed) >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
const percent = (count, total) => total ? count / total * 100 : 0;
const clampProbability = probability => Math.min(1 - 1e-6, Math.max(1e-6, probability));

function inferDivisionsFromSchedule(season) {
  const games = history.MatchLog_PlayoffIncluded.filter(game => Number(game.season) === Number(season) && game.game_type === 'regular');
  const pairCounts = new Map();
  games.forEach(game => {
    const pair = [game.awayTeamName, game.homeTeamName].sort();
    const key = pair.join('|');
    pairCounts.set(key, { pair, count: (pairCounts.get(key)?.count || 0) + 1 });
  });
  const graph = new Map();
  [...pairCounts.values()].filter(item => item.count > 1).forEach(({ pair: [left, right] }) => {
    if (!graph.has(left)) graph.set(left, new Set());
    if (!graph.has(right)) graph.set(right, new Set());
    graph.get(left).add(right);
    graph.get(right).add(left);
  });
  const components = [];
  const seen = new Set();
  [...graph.keys()].sort().forEach(start => {
    if (seen.has(start)) return;
    const members = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const name = queue.shift();
      members.push(name);
      graph.get(name)?.forEach(next => {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      });
    }
    components.push(members.sort());
  });
  if (components.length !== 3 || components.some(group => group.length !== 4)) {
    throw new Error(`Could not infer three four-team divisions from the ${season} repeat-opponent schedule`);
  }
  return Object.fromEntries(components.sort((a, b) => a[0].localeCompare(b[0])).map((members, index) => [String(index + 1), members]));
}

async function fetchSeasonConfiguration({ season, league_id: leagueId }) {
  const [leagueResponse, rostersResponse] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${leagueId}`),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)
  ]);
  if (!leagueResponse.ok || !rostersResponse.ok) throw new Error(`Sleeper data unavailable for ${season}`);
  const league = await leagueResponse.json();
  const rosters = await rostersResponse.json();
  let divisions = {};
  let divisionByTeam = new Map();
  rosters.forEach(roster => {
    const name = canonicalByUserId.get(String(roster.owner_id));
    if (!name) return;
    if (roster.settings?.division == null) return;
    const division = String(roster.settings.division);
    divisionByTeam.set(name, division);
    if (!divisions[division]) divisions[division] = [];
    divisions[division].push(name);
  });
  let divisionSource = 'sleeper_rosters';
  if (divisionByTeam.size !== 12 || Object.keys(divisions).length !== 3) {
    divisions = inferDivisionsFromSchedule(season);
    divisionByTeam = new Map(Object.entries(divisions).flatMap(([division, members]) => members.map(name => [name, division])));
    divisionSource = 'inferred_from_repeat_opponents';
  }
  if (Number(league.settings?.playoff_teams || 0) !== 6) {
    throw new Error(`Expected a six-team playoff field for ${season}`);
  }
  return {
    season: Number(season),
    leagueId,
    playoffStartWeek: Number(league.settings?.playoff_week_start || (Number(season) <= 2020 ? 14 : 15)),
    playoffTeams: Number(league.settings?.playoff_teams || 6),
    divisions,
    divisionByTeam,
    divisionSource
  };
}

function buildCheckpoint(games, config, completedWeek) {
  const played = games.filter(game => game.week <= completedWeek);
  const names = [...new Set(games.flatMap(game => [game.awayTeamName, game.homeTeamName]))].sort();
  const teams = names.map(name => {
    const teamGames = played.filter(game => game.awayTeamName === name || game.homeTeamName === name);
    const weeklyScores = teamGames.sort((a, b) => a.week - b.week).map(game => (
      game.awayTeamName === name ? Number(game.awayScore) : Number(game.homeScore)
    ));
    return {
      name,
      wins: teamGames.filter(game => game.winner === name).length,
      losses: teamGames.filter(game => game.loser === name).length,
      fpts: weeklyScores.reduce((sum, value) => sum + value, 0),
      weeklyScores,
      division: config.divisionByTeam.get(name) || '1'
    };
  });
  const remainingSchedule = games
    .filter(game => game.week > completedWeek)
    .sort((a, b) => a.week - b.week)
    .map(game => [game.awayTeamName, game.homeTeamName]);
  return { teams, remainingSchedule };
}

function actualOutcomes(allGames, config) {
  const regularGames = allGames.filter(game => game.game_type === 'regular');
  const playoffGames = allGames.filter(game => game.game_type === 'playoff');
  const final = buildCheckpoint(regularGames, config, config.playoffStartWeek - 1).teams;
  const sorted = [...final].sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
  const playoffTeams = new Set(playoffGames.flatMap(game => [game.awayTeamName, game.homeTeamName]));
  const firstPlayoffWeek = config.playoffStartWeek;
  const openingRoundTeams = new Set(playoffGames.filter(game => game.week === firstPlayoffWeek).flatMap(game => [game.awayTeamName, game.homeTeamName]));
  const divisionWinners = new Set(Object.values(config.divisions).map(members => (
    [...final].filter(team => members.includes(team.name)).sort((a, b) => b.wins - a.wins || b.fpts - a.fpts)[0]?.name
  )).filter(Boolean));
  return new Map(final.map(team => [team.name, {
    playoff: playoffTeams.has(team.name),
    bye: playoffTeams.has(team.name) && !openingRoundTeams.has(team.name),
    divisionWinner: divisionWinners.has(team.name),
    last: sorted.at(-1)?.name === team.name
  }]));
}

function metrics(rows, field) {
  const usable = rows.filter(row => Number.isFinite(row[field]) && typeof row.actual[field] === 'boolean');
  const brier = usable.reduce((sum, row) => sum + (row[field] / 100 - Number(row.actual[field])) ** 2, 0) / usable.length;
  const logLoss = usable.reduce((sum, row) => {
    const probability = clampProbability(row[field] / 100);
    return sum - (row.actual[field] ? Math.log(probability) : Math.log(1 - probability));
  }, 0) / usable.length;
  const observedBaseRate = usable.filter(row => row.actual[field]).length / usable.length;
  const uninformedBrier = observedBaseRate * (1 - observedBaseRate);
  const calibration = Array.from({ length: 10 }, (_, index) => {
    const low = index * 10;
    const high = index === 9 ? 100.0001 : low + 10;
    const bucket = usable.filter(row => row[field] >= low && row[field] < high);
    return {
      range: `${low}-${Math.min(100, low + 10)}%`,
      forecasts: bucket.length,
      meanPrediction: bucket.length ? bucket.reduce((sum, row) => sum + row[field], 0) / bucket.length : null,
      observedRate: bucket.length ? bucket.filter(row => row.actual[field]).length / bucket.length * 100 : null
    };
  }).filter(bucket => bucket.forecasts);
  return {
    forecasts: usable.length,
    observedBaseRate: observedBaseRate * 100,
    brier,
    uninformedBrier,
    brierSkillScore: uninformedBrier ? 1 - brier / uninformedBrier : null,
    logLoss,
    calibration
  };
}

const seasonEntries = discovery.seasons
  .filter(entry => Number(entry.season) >= 2019 && Number(entry.season) <= 2025)
  .sort((a, b) => Number(a.season) - Number(b.season));
const configurations = [];
for (const entry of seasonEntries) configurations.push(await fetchSeasonConfiguration(entry));

const forecasts = [];
for (const config of configurations) {
  const seasonGames = history.MatchLog_PlayoffIncluded.filter(game => Number(game.season) === config.season);
  const regularGames = seasonGames.filter(game => game.game_type === 'regular');
  const actual = actualOutcomes(seasonGames, config);
  // Exclude the final regular-season week: by then the playoff field is already determined.
  for (let completedWeek = 1; completedWeek < config.playoffStartWeek - 1; completedWeek += 1) {
    const checkpoint = buildCheckpoint(regularGames, config, completedWeek);
    const results = runPlayoffSimulation({
      ...checkpoint,
      simulations,
      model: 'Bayesian',
      priorStd: 25,
      minSigma: 20,
      divisions: config.divisions,
      rng: seededRandom(config.season * 100000 + completedWeek * 100 + simulations)
    });
    results.forEach(result => forecasts.push({
      season: config.season,
      weekCompleted: completedWeek,
      team: result.name,
      playoff: percent(result.playoffCount, simulations),
      bye: percent(result.byeCount, simulations),
      divisionWinner: percent(result.divWinnerCount, simulations),
      last: percent(result.lastCount, simulations),
      actual: actual.get(result.name)
    }));
  }
  process.stdout.write(`Reconstructed ${config.season}\n`);
}

const output = {
  generatedAt: new Date().toISOString(),
  source: 'reconstructed_walk_forward',
  warning: 'Forecasts were reconstructed with the current model using only information available through each checkpoint; they were not saved contemporaneously.',
  seasons: configurations.map(config => config.season),
  seasonConfiguration: configurations.map(config => ({
    season: config.season,
    playoffStartWeek: config.playoffStartWeek,
    playoffTeams: config.playoffTeams,
    divisionSource: config.divisionSource,
    divisions: config.divisions
  })),
  simulationsPerCheckpoint: simulations,
  checkpoints: new Set(forecasts.map(row => `${row.season}-${row.weekCompleted}`)).size,
  teamForecasts: forecasts.length,
  metrics: {
    playoff: metrics(forecasts, 'playoff'),
    bye: metrics(forecasts, 'bye'),
    divisionWinner: metrics(forecasts, 'divisionWinner'),
    last: metrics(forecasts, 'last')
  },
  forecasts
};
await fs.writeFile(path.join(root, 'public/data/historical_backtest.json'), `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`Saved ${output.checkpoints} checkpoints and ${output.teamForecasts} team forecasts.\n`);
