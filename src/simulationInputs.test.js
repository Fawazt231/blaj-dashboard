import test from 'node:test';
import assert from 'node:assert/strict';

import { collectCompletedWeeklyScores } from './simulationInputs.js';

test('collects completed weekly scores and excludes the active week', () => {
  const matchups = {
    1: [[
      { points: 101.5, team_info: { canonical_name: 'A' } },
      { points: 99.2, team_info: { canonical_name: 'B' } }
    ]],
    2: [[
      { points: 88.1, team_info: { canonical_name: 'A' } },
      { points: 120.4, team_info: { canonical_name: 'B' } }
    ]]
  };

  assert.deepEqual(collectCompletedWeeklyScores(matchups, 2), {
    A: [101.5],
    B: [99.2]
  });
});
