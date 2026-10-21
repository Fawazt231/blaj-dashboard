import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshots = JSON.parse(
  await fs.readFile(path.join(root, 'data/historical_roster_snapshots.json'), 'utf8')
);
const outputPath = process.env.ROSTER_FEATURE_OUTPUT
  ? path.resolve(root, process.env.ROSTER_FEATURE_OUTPUT)
  : path.join(root, 'data/historical_roster_projection_features.json');

const FLEX_POSITIONS = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['WR', 'RB'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE']
};

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`);
  return response.json();
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function customProjection(stats, scoringSettings) {
  return Object.entries(scoringSettings).reduce(
    (total, [stat, weight]) => total + Number(stats?.[stat] || 0) * Number(weight || 0),
    0
  );
}

function eligible(position, slot) {
  return position === slot || (FLEX_POSITIONS[slot] || []).includes(position);
}

function optimizeLineup(players, rosterPositions) {
  const slots = rosterPositions.filter(slot => slot !== 'BN' && slot !== 'IR');
  const fullMask = (1 << slots.length) - 1;
  let states = new Map([[0, { total: 0, lineup: [] }]]);

  players.forEach(player => {
    const next = new Map(states);
    states.forEach((state, mask) => {
      slots.forEach((slot, slotIndex) => {
        const bit = 1 << slotIndex;
        if ((mask & bit) || !eligible(player.position, slot)) return;
        const candidate = {
          total: state.total + player.projectedPoints,
          lineup: [...state.lineup, { slot, ...player }]
        };
        const nextMask = mask | bit;
        if (!next.has(nextMask) || next.get(nextMask).total < candidate.total) {
          next.set(nextMask, candidate);
        }
      });
    });
    states = next;
  });

  const best = states.get(fullMask);
  return best
    ? { complete: true, total: best.total, lineup: best.lineup }
    : { complete: false, total: null, lineup: [] };
}

const seasons = [];
for (const season of snapshots.seasons) {
  const checkpoints = [];
  // A Week N report uses the completed Week N roster with the archived Week N+1
  // projection. It never uses the future week's finalized roster or starters.
  for (const completed of season.weeks.slice(0, -1)) {
    const projectionWeek = completed.week + 1;
    const url = `https://api.sleeper.com/projections/nfl/${season.season}/${projectionWeek}?season_type=regular`;
    const projectionRows = await fetchJson(url);
    const rosteredIds = new Set(completed.teams.flatMap(team => team.players).map(String));
    const projections = new Map();

    projectionRows.forEach(row => {
      const playerId = String(row.player_id || '');
      if (!rosteredIds.has(playerId) || !row.stats) return;
      const position = row.player?.position || row.player?.fantasy_positions?.[0];
      if (!position) return;
      projections.set(playerId, {
        playerId,
        name: [row.player?.first_name, row.player?.last_name].filter(Boolean).join(' ') || playerId,
        position,
        projectedPoints: customProjection(row.stats, season.scoringSettings)
      });
    });

    const teams = completed.teams.map(team => {
      const players = team.players.map(playerId => projections.get(String(playerId))).filter(Boolean);
      const optimized = optimizeLineup(players, season.rosterPositions);
      const selected = new Set(optimized.lineup.map(player => player.playerId));
      const bench = players.filter(player => !selected.has(player.playerId));
      const sortedLineup = [...optimized.lineup].sort((a, b) => b.projectedPoints - a.projectedPoints);
      const sortedBench = [...bench].sort((a, b) => b.projectedPoints - a.projectedPoints);
      const topThree = sortedLineup.slice(0, 3).reduce((sum, player) => sum + player.projectedPoints, 0);
      return {
        rosterId: team.rosterId,
        team: team.team,
        rosterPlayers: team.players.length,
        projectedPlayers: players.length,
        coverage: team.players.length ? round(players.length / team.players.length, 4) : 0,
        lineupComplete: optimized.complete,
        optimalProjectedPoints: optimized.complete ? round(optimized.total) : null,
        topThreeShare: optimized.complete && optimized.total > 0 ? round(topThree / optimized.total, 4) : null,
        benchTopThreePoints: round(sortedBench.slice(0, 3).reduce((sum, player) => sum + player.projectedPoints, 0)),
        optimalLineup: sortedLineup.map(player => ({
          slot: player.slot,
          playerId: player.playerId,
          name: player.name,
          position: player.position,
          projectedPoints: round(player.projectedPoints)
        }))
      };
    });
    checkpoints.push({ completedWeek: completed.week, projectionWeek, teams });
    process.stdout.write(`${season.season} Week ${completed.week} -> ${projectionWeek}\n`);
  }

  const teamRows = checkpoints.flatMap(checkpoint => checkpoint.teams);
  seasons.push({
    season: season.season,
    audit: {
      checkpoints: checkpoints.length,
      teamCheckpoints: teamRows.length,
      completeLineups: teamRows.filter(team => team.lineupComplete).length,
      meanRosterCoverage: round(
        teamRows.reduce((sum, team) => sum + team.coverage, 0) / Math.max(1, teamRows.length),
        4
      )
    },
    checkpoints
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  status: 'experimental_challenger_input',
  projectionSource: 'Sleeper archived weekly projections (unofficial endpoint)',
  forecastTiming: 'Completed-week roster combined with the following week projection; future finalized rosters and starters are excluded.',
  warnings: [
    'The projection endpoint is not part of Sleeper’s documented public API and may change or disappear.',
    'Nested player metadata may be current rather than historically versioned; only identity and position are used.',
    'Historical injury status is not treated as a separately reliable feature.',
    'These features must not affect production odds until leave-one-season-out validation beats the tuned PF model.'
  ],
  seasons
};

await fs.writeFile(outputPath, `${JSON.stringify(output)}\n`);
process.stdout.write(`Saved ${path.relative(root, outputPath)}\n`);
