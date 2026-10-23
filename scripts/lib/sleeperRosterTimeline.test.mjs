import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deduplicateTransactions,
  parseCsv,
  reconstructRostersAtCutoff,
  transactionEffectiveAt,
  weeklyRosterWindow,
  zonedDateTimeToEpochMs
} from './sleeperRosterTimeline.mjs';

test('transaction completion time takes precedence over submission time', () => {
  assert.deepEqual(
    transactionEffectiveAt({ created: 100, status_updated: 250 }),
    { timestamp: 250, source: 'status_updated' }
  );
  assert.deepEqual(
    transactionEffectiveAt({ created: 100 }),
    { timestamp: 100, source: 'created_fallback' }
  );
});

test('transaction deduplication retains the latest copy', () => {
  const transactions = deduplicateTransactions([
    { transaction_id: 'a', status: 'pending', created: 100 },
    { transaction_id: 'a', status: 'complete', created: 100, status_updated: 200 }
  ]);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].status, 'complete');
  assert.equal(transactions[0].effectiveAt, 200);
});

test('normalized transactions can be safely deduplicated again', () => {
  const once = deduplicateTransactions([
    { transaction_id: 'a', status: 'complete', status_updated: 200, adds: { player: 1 } }
  ]);
  const twice = deduplicateTransactions(once);
  assert.deepEqual(twice, once);
});

test('reconstruction applies only completed transactions inside the point-in-time window', () => {
  const result = reconstructRostersAtCutoff({
    anchorTeams: [
      { rosterId: 1, players: ['a', 'b'] },
      { rosterId: 2, players: ['c'] }
    ],
    anchorAt: 1_000,
    cutoffAt: 2_000,
    transactions: [
      { transaction_id: 'old', status: 'complete', status_updated: 900, drops: { a: 1 } },
      { transaction_id: 'failed', status: 'failed', status_updated: 1_200, drops: { b: 1 } },
      {
        transaction_id: 'trade',
        status: 'complete',
        status_updated: 1_500,
        drops: { b: 1, c: 2 },
        adds: { b: 2, c: 1 },
        roster_ids: [1, 2]
      },
      { transaction_id: 'future', status: 'complete', status_updated: 2_100, adds: { d: 1 } }
    ]
  });

  assert.deepEqual(result.rosters, { 1: ['a', 'c'], 2: ['b'] });
  assert.equal(result.audit.applied, 1);
  assert.equal(result.audit.ignoredBeforeAnchor, 1);
  assert.equal(result.audit.ignoredIncomplete, 1);
  assert.equal(result.audit.ignoredAfterCutoff, 1);
  assert.deepEqual(result.audit.duplicatePlayers, []);
});

test('New York conversion observes daylight-saving time', () => {
  assert.equal(
    new Date(zonedDateTimeToEpochMs({ year: 2024, month: 9, day: 10, hour: 9 })).toISOString(),
    '2024-09-10T13:00:00.000Z'
  );
  assert.equal(
    new Date(zonedDateTimeToEpochMs({ year: 2024, month: 12, day: 10, hour: 9 })).toISOString(),
    '2024-12-10T14:00:00.000Z'
  );
});

test('weekly roster window follows the latest game, including non-Monday finales', () => {
  const rows = [
    { season: '2020', week: '5', game_type: 'REG', gameday: '2020-10-11', gametime: '13:00' },
    { season: '2020', week: '5', game_type: 'REG', gameday: '2020-10-13', gametime: '19:00' }
  ];
  const window = weeklyRosterWindow(rows, { season: 2020, week: 5 });
  assert.equal(new Date(window.latestKickoff).toISOString(), '2020-10-13T23:00:00.000Z');
  assert.equal(new Date(window.anchorAt).toISOString(), '2020-10-14T05:00:00.000Z');
  assert.equal(new Date(window.cutoffAt).toISOString(), '2020-10-14T13:00:00.000Z');
});

test('CSV parser supports quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('a,b\n1,"two, three"\n2,"say ""hi"""\n'), [
    { a: '1', b: 'two, three' },
    { a: '2', b: 'say "hi"' }
  ]);
});
