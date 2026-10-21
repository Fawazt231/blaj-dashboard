import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const discovery = JSON.parse(await fs.readFile(path.join(root, 'data_discovery.json'), 'utf8'));
const managers = JSON.parse(await fs.readFile(path.join(root, 'managers.json'), 'utf8'));
const outputPath = process.env.ROSTER_BACKFILL_OUTPUT
  ? path.resolve(root, process.env.ROSTER_BACKFILL_OUTPUT)
  : path.join(root, 'data/historical_roster_snapshots.json');
const requestedSeasons = new Set(
  (process.env.ROSTER_BACKFILL_SEASONS || '2019,2020,2021,2022,2023,2024,2025')
    .split(',')
    .map(Number)
    .filter(Number.isFinite)
);

const canonicalByUserId = new Map(
  Object.entries(managers.users).map(([id, value]) => [id, value.canonical_name])
);

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`);
  return response.json();
}

function compactPoints(points) {
  if (!points || Array.isArray(points) || typeof points !== 'object') return points || {};
  return Object.fromEntries(
    Object.entries(points).map(([playerId, value]) => [playerId, Number(value || 0)])
  );
}

async function backfillSeason(entry) {
  const season = Number(entry.season);
  const leagueId = entry.league_id;
  const base = `https://api.sleeper.app/v1/league/${leagueId}`;
  const [league, rosters] = await Promise.all([
    fetchJson(base),
    fetchJson(`${base}/rosters`)
  ]);
  const playoffStartWeek = Number(league.settings?.playoff_week_start || (season <= 2020 ? 14 : 15));
  const ownerByRoster = new Map(
    rosters.map(roster => [Number(roster.roster_id), String(roster.owner_id || '')])
  );
  const weeks = [];

  for (let week = 1; week < playoffStartWeek; week += 1) {
    const matchups = await fetchJson(`${base}/matchups/${week}`);
    const teams = matchups
      .map(item => {
        const ownerId = ownerByRoster.get(Number(item.roster_id)) || null;
        return {
          rosterId: Number(item.roster_id),
          ownerId,
          team: canonicalByUserId.get(ownerId) || null,
          matchupId: Number(item.matchup_id),
          points: Number(item.points || 0),
          starters: item.starters || [],
          players: item.players || [],
          startersPoints: (item.starters_points || []).map(value => Number(value || 0)),
          playersPoints: compactPoints(item.players_points)
        };
      })
      .sort((left, right) => left.rosterId - right.rosterId);
    weeks.push({ week, teams });
  }

  const teamWeeks = weeks.flatMap(week => week.teams);
  const audit = {
    weeks: weeks.length,
    teamWeeks: teamWeeks.length,
    expectedTeamWeeks: (playoffStartWeek - 1) * Number(league.total_rosters || 12),
    fullRosterSnapshots: teamWeeks.filter(team => team.players.length > 0).length,
    starterSnapshots: teamWeeks.filter(team => team.starters.length > 0).length,
    playerPointSnapshots: teamWeeks.filter(team => Object.keys(team.playersPoints).length > 0).length,
    unmappedOwners: teamWeeks.filter(team => !team.team).length
  };

  process.stdout.write(
    `${season}: ${audit.fullRosterSnapshots}/${audit.teamWeeks} full rosters, ` +
    `${audit.playerPointSnapshots}/${audit.teamWeeks} player-point snapshots\n`
  );

  return {
    season,
    leagueId,
    playoffStartWeek,
    rosterPositions: league.roster_positions || [],
    scoringSettings: league.scoring_settings || {},
    audit,
    weeks
  };
}

const entries = discovery.seasons
  .filter(entry => requestedSeasons.has(Number(entry.season)))
  .sort((left, right) => Number(left.season) - Number(right.season));

if (!entries.length) throw new Error('No matching seasons found in data_discovery.json');

const seasons = [];
for (const entry of entries) seasons.push(await backfillSeason(entry));

const output = {
  generatedAt: new Date().toISOString(),
  source: 'Sleeper documented weekly matchup endpoint',
  forecastTiming: 'Each week is a point-in-time roster snapshot from that completed matchup week.',
  limitations: [
    '2017-2018 are excluded because the repository has only team-level Excel history for those seasons.',
    'Final-season roster endpoints are used only to map stable roster IDs to owners, never as roster composition.',
    'Historical injury status and external projections are not included in this file.'
  ],
  seasons
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output)}\n`);
process.stdout.write(`Saved ${path.relative(root, outputPath)}\n`);
