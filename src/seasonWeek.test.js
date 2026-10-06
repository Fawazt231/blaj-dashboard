import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCurrentWeek } from './seasonWeek.js';

test('advances after Sleeper finalizes the current leg', () => {
  const league = { settings: { leg: 4, last_scored_leg: 4 } };
  assert.equal(resolveCurrentWeek(league, 4), 5);
});

test('does not advance while the active leg is still unscored', () => {
  const league = { settings: { leg: 5, last_scored_leg: 4 } };
  assert.equal(resolveCurrentWeek(league, 4), 5);
});

test('uses the saved week when the live request is unavailable', () => {
  assert.equal(resolveCurrentWeek({}, 4), 4);
});
