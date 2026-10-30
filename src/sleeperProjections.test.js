import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectionLookup,
  buildProjectionTeamLookup,
  calculateProjectedPoints,
  projectedLineupTotal
} from './sleeperProjections.js';

test('calculates projections with the league scoring settings', () => {
  const points = calculateProjectedPoints(
    { pass_yd: 250, pass_td: 2, pass_int: 1, rush_yd: 20, rush_fd: 2 },
    { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_fd: 0.5 }
  );
  assert.equal(points, 19);
});

test('keeps only requested players and totals the active lineup', () => {
  const lookup = buildProjectionLookup([
    { player_id: 'a', stats: { rush_yd: 80, rush_td: 1 } },
    { player_id: 'b', stats: { rec_yd: 50 } },
    { player_id: 'bench', stats: { rush_yd: 200 } }
  ], ['a', 'b'], { rush_yd: 0.1, rush_td: 6, rec_yd: 0.1 });

  assert.deepEqual(lookup, { a: 14, b: 5 });
  assert.equal(projectedLineupTotal(['a', 'b'], lookup), 19);
  assert.equal(projectedLineupTotal(['missing'], lookup), null);
});

test('repairs Sleeper projection fields that mirror yardage points instead of first downs', () => {
  const lookup = buildProjectionLookup([{
    player_id: 'wr',
    team: 'CAR',
    player: { position: 'WR' },
    stats: { rec: 5, rec_yd: 70, rec_fd: 7, rec_td: 0 }
  }], ['wr'], { rec_yd: 0.1, rec_fd: 0.5 });

  assert.ok(Math.abs(lookup.wr - 8.3075) < 1e-9);
});

test('uses actual points for completed players when calculating projected final score', () => {
  const rows = [
    { player_id: 'done', team: 'GB', player: { position: 'RB' }, stats: { rush_yd: 100 } },
    { player_id: 'upcoming', team: 'BUF', player: { position: 'WR' }, stats: { rec_yd: 80 } }
  ];
  const lookup = buildProjectionLookup(rows, ['done', 'upcoming'], { rush_yd: 0.1, rec_yd: 0.1 });
  const playerTeams = buildProjectionTeamLookup(rows, ['done', 'upcoming']);

  assert.equal(projectedLineupTotal(['done', 'upcoming'], lookup, {
    actualPoints: { done: 17, upcoming: 0 },
    playerTeams,
    gameStatuses: { GB: 'complete', BUF: 'pre_game' }
  }), 25);
});
