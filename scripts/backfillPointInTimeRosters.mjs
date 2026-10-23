import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deduplicateTransactions,
  parseCsv,
  reconstructRostersAtCutoff,
  weeklyRosterWindow
} from './lib/sleeperRosterTimeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotsPath = process.env.ROSTER_SNAPSHOT_INPUT
  ? path.resolve(root, process.env.ROSTER_SNAPSHOT_INPUT)
  : path.join(root, 'data/historical_roster_snapshots.json');
const outputPath = process.env.POINT_IN_TIME_ROSTER_OUTPUT
  ? path.resolve(root, process.env.POINT_IN_TIME_ROSTER_OUTPUT)
  : path.join(root, 'data/historical_point_in_time_rosters.json');
const scheduleUrl = process.env.NFL_SCHEDULE_URL ||
  'https://github.com/nflverse/nfldata/raw/master/data/games.csv';
const requestedSeasons = new Set(
  (process.env.ROSTER_BACKFILL_SEASONS || '2019,2020,2021,2022,2023,2024,2025')
    .split(',')
    .map(Number)
    .filter(Number.isFinite)
);

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`);
  return response.json();
}

async function loadSchedule() {
  if (process.env.NFL_SCHEDULE_FILE) {
    return parseCsv(await fs.readFile(path.resolve(root, process.env.NFL_SCHEDULE_FILE), 'utf8'));
  }
  return parseCsv(await fetchText(scheduleUrl));
}

async function fetchTransactions(leagueId, lastRound) {
  const rows = [];
  for (let round = 1; round <= lastRound; round += 1) {
    const roundRows = await fetchJson(
      `https://api.sleeper.app/v1/league/${leagueId}/transactions/${round}`
    );
    rows.push(...roundRows);
  }
  return deduplicateTransactions(rows);
}

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

function countBy(rows, field) {
  return Object.fromEntries(
    Object.entries(Object.groupBy(rows, row => row[field] ?? 'unknown'))
      .map(([key, values]) => [key, values.length])
  );
}

const snapshots = JSON.parse(await fs.readFile(snapshotsPath, 'utf8'));
const schedule = await loadSchedule();
const seasons = [];

for (const season of snapshots.seasons.filter(item => requestedSeasons.has(Number(item.season)))) {
  const transactions = await fetchTransactions(season.leagueId, season.playoffStartWeek);
  const checkpoints = season.weeks.map(week => {
    const window = weeklyRosterWindow(schedule, {
      season: season.season,
      week: week.week,
      timeZone: 'America/New_York',
      gameEndBufferHours: 6,
      reportHour: 9
    });
    const result = reconstructRostersAtCutoff({
      anchorTeams: week.teams,
      transactions,
      anchorAt: window.anchorAt,
      cutoffAt: window.cutoffAt
    });
    const teams = week.teams.map(team => ({
      rosterId: team.rosterId,
      ownerId: team.ownerId,
      team: team.team,
      players: result.rosters[team.rosterId] || []
    }));
    const rosterChanges = teams.map(team => {
      const anchor = new Set(
        (week.teams.find(item => item.rosterId === team.rosterId)?.players || []).map(String)
      );
      const reconstructed = new Set(team.players);
      return {
        rosterId: team.rosterId,
        added: [...reconstructed].filter(playerId => !anchor.has(playerId)).sort(),
        removed: [...anchor].filter(playerId => !reconstructed.has(playerId)).sort()
      };
    }).filter(change => change.added.length || change.removed.length);
    return {
      completedWeek: week.week,
      latestKickoff: iso(window.latestKickoff),
      estimatedMatchupAnchor: iso(window.anchorAt),
      forecastCutoff: iso(window.cutoffAt),
      appliedTransactions: result.appliedTransactions.map(item => ({
        transactionId: item.transactionId,
        type: item.type,
        effectiveAt: iso(item.effectiveAt),
        adds: item.adds,
        drops: item.drops
      })),
      rosterChanges,
      audit: result.audit,
      teams
    };
  });

  const audits = checkpoints.map(checkpoint => checkpoint.audit);
  const seasonAudit = {
    checkpoints: checkpoints.length,
    fetchedTransactions: transactions.length,
    completedTransactions: transactions.filter(item => item.status === 'complete').length,
    transactionsAppliedInsideWindows: audits.reduce((sum, audit) => sum + audit.applied, 0),
    transactionTypes: countBy(transactions, 'type'),
    transactionStatuses: countBy(transactions, 'status'),
    transactionTimestampSources: countBy(transactions, 'effectiveAtSource'),
    createdTimestampFallbacks: transactions.filter(
      item => item.effectiveAtSource === 'created_fallback'
    ).length,
    missingTimestamp: transactions.filter(item => !Number.isFinite(item.effectiveAt)).length,
    missingDrops: audits.reduce((sum, audit) => sum + audit.missingDrops.length, 0),
    implicitTransfers: audits.reduce((sum, audit) => sum + audit.implicitTransfers.length, 0),
    unknownDestinationRosters: audits.reduce(
      (sum, audit) => sum + audit.unknownDestinationRosters.length,
      0
    ),
    duplicatePlayerAssignments: audits.reduce((sum, audit) => sum + audit.duplicatePlayers.length, 0)
  };
  process.stdout.write(
    `${season.season}: ${seasonAudit.checkpoints} checkpoints; ` +
    `${seasonAudit.transactionsAppliedInsideWindows} transactions applied; ` +
    `${seasonAudit.missingDrops} unmatched drops; ` +
    `${seasonAudit.duplicatePlayerAssignments} duplicate players\n`
  );
  seasons.push({
    season: season.season,
    leagueId: season.leagueId,
    playoffStartWeek: season.playoffStartWeek,
    audit: seasonAudit,
    checkpoints
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  status: 'research_input_not_used_by_production_simulation',
  sources: {
    rosterAnchor: 'Sleeper documented GET /v1/league/{league_id}/matchups/{week}',
    transactions: 'Sleeper documented GET /v1/league/{league_id}/transactions/{round}',
    schedule: scheduleUrl
  },
  pointInTimePolicy: {
    timeZone: 'America/New_York',
    forecastCutoff: '09:00 ET on the calendar day after the final NFL kickoff assigned to the completed week.',
    matchupAnchor: 'The finalized Sleeper matchup players list, treated as authoritative through six hours after the final kickoff.',
    transactionTimestamp: 'status_updated is the effective time; created is used only when status_updated is absent.',
    transactionFilter: 'Only status=complete mutations after the estimated matchup anchor and at or before the forecast cutoff are applied.'
  },
  limitations: [
    'Sleeper matchup rows do not include a snapshot timestamp. The six-hour post-kickoff anchor is an explicit conservative assumption, not a fact supplied by Sleeper.',
    'The players list is the finalized roster attached to that matchup. It may not reproduce intraday roster state before every individual NFL game lock.',
    'Transactions after the cutoff are intentionally excluded even if they appear in the following week matchup.',
    'created is submission time and can predate waiver or trade completion; rows requiring that fallback are counted in every audit.',
    'Draft picks and traded draft picks do not change the current player roster and are preserved only in Sleeper, not replayed here.',
    'This artifact is an auditable research input and does not alter production simulation probabilities.'
  ],
  seasons
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`Saved ${path.relative(root, outputPath)}\n`);
