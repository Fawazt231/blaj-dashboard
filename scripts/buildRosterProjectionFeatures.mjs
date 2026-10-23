import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSnapshotsPath = path.join(root, 'data/historical_roster_snapshots.json');
const rosterInputPath = process.env.ROSTER_FEATURE_ROSTER_INPUT
  ? path.resolve(root, process.env.ROSTER_FEATURE_ROSTER_INPUT)
  : defaultSnapshotsPath;
const snapshots = JSON.parse(await fs.readFile(rosterInputPath, 'utf8'));
const leagueConfigurations = JSON.parse(await fs.readFile(defaultSnapshotsPath, 'utf8'));
const pointInTimeRosters = Boolean(snapshots.pointInTimePolicy);
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
  const leagueConfiguration = leagueConfigurations.seasons.find(
    item => Number(item.season) === Number(season.season)
  );
  if (!leagueConfiguration) throw new Error(`Missing league configuration for ${season.season}`);
  const rosterPositions = season.rosterPositions || leagueConfiguration.rosterPositions;
  const scoringSettings = season.scoringSettings || leagueConfiguration.scoringSettings;
  const playoffStartWeek = Number(season.playoffStartWeek || leagueConfiguration.playoffStartWeek);
  const sourceCheckpoints = season.weeks
    ? season.weeks.map(week => ({ completedWeek: week.week, teams: week.teams }))
    : season.checkpoints;
  const checkpoints = [];
  // A Week N report combines the selected point-in-time roster source with the
  // archived Week N+1 projection. It never uses future finalized starters.
  for (const completed of sourceCheckpoints.filter(
    checkpoint => Number(checkpoint.completedWeek) < playoffStartWeek - 1
  )) {
    const projectionWeek = completed.completedWeek + 1;
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
        projectedPoints: customProjection(row.stats, scoringSettings)
      });
    });

    const teams = completed.teams.map(team => {
      const players = team.players.map(playerId => projections.get(String(playerId))).filter(Boolean);
      const optimized = optimizeLineup(players, rosterPositions);
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
    checkpoints.push({ completedWeek: completed.completedWeek, projectionWeek, teams });
    process.stdout.write(`${season.season} Week ${completed.completedWeek} -> ${projectionWeek}\n`);
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
  rosterSource: path.relative(root, rosterInputPath),
  forecastTiming: pointInTimeRosters
    ? 'Reconstructed report-cutoff roster combined with the following week projection.'
    : 'Completed-week roster combined with the following week projection; future finalized rosters and starters are excluded.',
  warnings: [
    'The projection endpoint is not part of Sleeper’s documented public API and may change or disappear.',
    'Nested player metadata may be current rather than historically versioned; only identity and position are used.',
    'Historical injury status is not treated as a separately reliable feature.',
    'These features must not affect production odds until leave-one-season-out validation beats the tuned PF model.',
    ...(pointInTimeRosters
      ? ['Roster timing inherits the documented assumptions and limitations in data/historical_point_in_time_rosters.json.']
      : [])
  ],
  seasons
};

await fs.writeFile(outputPath, `${JSON.stringify(output)}\n`);
process.stdout.write(`Saved ${path.relative(root, outputPath)}\n`);
