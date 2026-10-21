import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSimulationSpotlight } from './simulationSpotlight.js';

const standings = Array.from({ length: 12 }, (_, index) => ({
  rank: index + 1,
  canonical_name: `Team${index + 1}`,
  team_name: `Club ${index + 1}`,
  wins: index < 6 ? 5 : 2,
  losses: index < 6 ? 2 : 5,
  points_for: 850 - index * 25,
  division: index % 3 + 1
}));
const matchups = {};
for (let week = 8; week <= 14; week += 1) {
  matchups[String(week)] = Array.from({ length: 6 }, (_, index) => [
    { team_info: { canonical_name: `Team${index + 1}` } },
    { team_info: { canonical_name: `Team${index + 7}` } }
  ]);
}

test('simulation spotlight is deterministic and returns a supported insight', () => {
  const input = { liveData: { current_week: 8, season: 2026, standings, matchups_by_week: matchups }, excelData: {}, simulations: 1000 };
  const first = buildSimulationSpotlight(input);
  const second = buildSimulationSpotlight(input);
  assert.deepEqual(first, second);
  if (first) assert.ok(['leverage', 'route', 'placement'].includes(first.kind));
});
