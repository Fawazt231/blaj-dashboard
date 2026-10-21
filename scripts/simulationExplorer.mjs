import fs from 'node:fs';
import { runSimulationExplorer, EXPLORER_OUTCOMES } from '../src/simulationExplorerEngine.js';
import { resolveCurrentWeek } from '../src/seasonWeek.js';
import { collectCompletedWeeklyScores } from '../src/simulationInputs.js';

const LEAGUE_ID = '1389388845572702208';
const livePath = new URL('../public/data/live_sleeper_data.json', import.meta.url);
const historyPath = new URL('../public/data/excel_history.json', import.meta.url);

const args = process.argv.slice(2);
const valueFor = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const normalize = value => String(value || '').trim().toLowerCase();
const requestedTeam = valueFor('--team', 'Nabbo');
const requestedOutcome = valueFor('--outcome', 'miss');
const simulations = Number(valueFor('--simulations', '100000'));
const seed = Number(valueFor('--seed', '231'));

if (!EXPLORER_OUTCOMES.includes(requestedOutcome)) {
  throw new Error(`--outcome must be one of: ${EXPLORER_OUTCOMES.join(', ')}`);
}
if (!Number.isInteger(simulations) || simulations < 1) throw new Error('--simulations must be a positive integer');

const live = JSON.parse(fs.readFileSync(livePath));
const history = JSON.parse(fs.readFileSync(historyPath));
let sleeperLeague = {};
let sleeperRosters = [];
let dataSource = 'saved dashboard data';
try {
  [sleeperLeague, sleeperRosters] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`).then(response => response.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`).then(response => response.json())
  ]);
  dataSource = 'live Sleeper standings';
} catch (error) {
  console.warn(`Live Sleeper request failed; using saved data (${error.message}).`);
}

const rosterById = new Map(sleeperRosters.map(roster => [String(roster.roster_id), roster]));
const currentWeek = resolveCurrentWeek(sleeperLeague, live.current_week);
const completedScores = collectCompletedWeeklyScores(live.matchups_by_week, currentWeek);
const teams = live.standings.map(team => {
  const roster = rosterById.get(String(team.roster_id));
  const settings = roster?.settings;
  const historical = (history.PerManagerSummary || []).find(item => item.manager === team.canonical_name);
  return {
    name: team.canonical_name,
    display: team.team_name,
    wins: settings ? Number(settings.wins || 0) : Number(team.wins || 0),
    losses: settings ? Number(settings.losses || 0) : Number(team.losses || 0),
    fpts: settings ? Number(settings.fpts || 0) + Number(settings.fpts_decimal || 0) / 100 : Number(team.points_for || 0),
    division: team.division || 1,
    weeklyScores: completedScores[team.canonical_name] || [],
    historicalAvg: historical ? Math.max(100, Number(historical.highest_score || 0) * 0.7) : 110
  };
});

const selectedTeam = teams.find(team => (
  normalize(team.name) === normalize(requestedTeam) || normalize(team.display) === normalize(requestedTeam)
));
if (!selectedTeam) throw new Error(`Unknown team: ${requestedTeam}`);

const scheduleMeta = [];
for (const [weekKey, pairs] of Object.entries(live.matchups_by_week || {})) {
  const week = Number(weekKey);
  if (week < currentWeek) continue;
  for (const pair of pairs || []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const away = pair[0].team_info?.canonical_name;
    const home = pair[1].team_info?.canonical_name;
    if (away && home) scheduleMeta.push({ week, away, home });
  }
}
scheduleMeta.sort((a, b) => a.week - b.week);
const remainingSchedule = scheduleMeta.map(game => [game.away, game.home]);

const result = runSimulationExplorer({
  teams,
  remainingSchedule,
  targetName: selectedTeam.name,
  outcome: requestedOutcome,
  simulations,
  seed,
  divisions: live.divisions || {}
});

const number = value => value === null ? 'n/a' : Number(value).toFixed(2);
const percent = value => value === null ? 'n/a' : `${Number(value).toFixed(3)}%`;
const profile = result.profile.conditional;
const routeText = Object.entries(result.routes)
  .filter(([, value]) => value.count)
  .map(([route, value]) => `${route} ${value.count.toLocaleString()} (${percent(value.pct)})`)
  .join(', ');

console.log(`\nSimulation Explorer: ${selectedTeam.display} (${selectedTeam.name})`);
console.log(`Outcome: ${requestedOutcome} | ${simulations.toLocaleString()} simulations | seed ${seed}`);
console.log(`Data: ${dataSource} | remaining schedule begins Week ${currentWeek}`);
console.log(`Observed: ${result.sampleSize.toLocaleString()} (${percent(result.probability)})`);
console.log(`Conditional final wins: median ${number(profile.wins.median)}, 10th-90th ${number(profile.wins.p10)}-${number(profile.wins.p90)}`);
console.log(`Conditional remaining wins: median ${number(profile.remainingWins.median)}, 10th-90th ${number(profile.remainingWins.p10)}-${number(profile.remainingWins.p90)}`);
console.log(`Conditional PF: median ${number(profile.fpts.median)}, 10th-90th ${number(profile.fpts.p10)}-${number(profile.fpts.p90)}`);
console.log(`Margin versus second PF qualifier: median ${number(profile.pointsCutoffMargin.median)}, 10th-90th ${number(profile.pointsCutoffMargin.p10)}-${number(profile.pointsCutoffMargin.p90)}, at/above ${percent(profile.pointsCutoffMargin.atOrAbovePct)}`);
if (routeText) console.log(`Routes: ${routeText}`);

console.log('\nHighest-leverage remaining games');
result.gameLeverage.slice(0, 8).forEach(item => {
  const game = scheduleMeta[item.index];
  console.log(`Week ${game?.week ?? '?'} vs ${item.opponent}: ${percent(item.withWin)} after win, ${percent(item.withLoss)} after loss, ${item.difference >= 0 ? '+' : ''}${number(item.difference)} pts (95% ${number(item.differenceInterval.low)} to ${number(item.differenceInterval.high)}, q=${number(item.qValue)}, ${item.evidence})`);
});

console.log('\nStrongest rival associations');
result.rivalDependencies.slice(0, 10).forEach(item => {
  console.log(`${item.rival} ${item.condition}: ${percent(item.probability)} when true, ${percent(item.complementProbability)} when false, ${item.difference >= 0 ? '+' : ''}${number(item.difference)} pts (95% ${number(item.differenceInterval.low)} to ${number(item.differenceInterval.high)}, q=${number(item.qValue)}, ${item.evidence}; n=${item.samples.toLocaleString()})`);
});

console.log('\nOutcome probability by final wins');
result.thresholds.wins.forEach(item => {
  console.log(`${item.wins} wins: ${percent(item.probability)} (n=${item.total.toLocaleString()})`);
});

console.log('\nOutcome probability by final PF range');
result.thresholds.pointsFor.filter(item => item.total >= 100).forEach(item => {
  console.log(`${item.floor}-${item.ceiling.toFixed(0)} PF: ${percent(item.probability)} (n=${item.total.toLocaleString()})`);
});

console.log('\nMost common remaining-season paths');
result.commonPaths.slice(0, 8).forEach(item => {
  console.log(`${item.path}: ${item.count.toLocaleString()} (${percent(item.pct)})`);
});

if (result.representativeScenarios.length) {
  const scenario = result.representativeScenarios[0];
  console.log(`\nRepresentative scenario (trial ${scenario.trial})`);
  scenario.standings.forEach(row => {
    console.log(`${String(row.rank).padStart(2)}. ${row.name.padEnd(12)} ${row.wins}-${row.losses}  ${row.fpts.toFixed(2)} PF  ${row.playoff ? 'PLAYOFF' : 'miss'}`);
  });
  console.log('Target schedule:');
  scenario.games.forEach(game => {
    const meta = scheduleMeta[game.index];
    console.log(`Week ${meta?.week ?? '?'}: ${game.result} vs ${game.opponent}, ${game.targetScore.toFixed(2)}-${game.opponentScore.toFixed(2)}`);
  });
}

