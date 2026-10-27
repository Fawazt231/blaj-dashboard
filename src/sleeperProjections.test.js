import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectionLookup,
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
