import test from 'node:test';
import assert from 'node:assert/strict';

import { runSimulationExplorer } from './simulationExplorerEngine.js';

const teams = Array.from({ length: 12 }, (_, index) => ({
  name: `Team${index + 1}`,
  wins: index < 6 ? 4 : 2,
  losses: index < 6 ? 2 : 4,
  fpts: 720 - index * 20,
  division: index % 3 + 1
}));
const remainingSchedule = Array.from({ length: 6 }, (_, index) => [
  `Team${index + 1}`,
  `Team${index + 7}`
]);

test('simulation explorer is deterministic and accounts for every trial', () => {
  const input = {
    teams,
    remainingSchedule,
    targetName: 'Team12',
    outcome: 'last',
    simulations: 500,
    seed: 42
  };
  const first = runSimulationExplorer(input);
  const second = runSimulationExplorer(input);

  assert.deepEqual(first, second);
  assert.equal(first.thresholds.wins.reduce((sum, item) => sum + item.total, 0), 500);
  assert.equal(first.gameLeverage.length, 1);
  assert.ok(first.sampleSize > 0);
  assert.ok(first.representativeScenarios.length <= 3);
  assert.equal(new Set(first.representativeScenarios.map(scenario => scenario.trial)).size, first.representativeScenarios.length);
  first.representativeScenarios.forEach(scenario => assert.ok(scenario.archetype));
  assert.ok(first.confidence95.low <= first.probability);
  assert.ok(first.confidence95.high >= first.probability);
  assert.ok(first.profile.all.placement.median >= 1);
  assert.ok(first.profile.all.placement.median <= teams.length);
  assert.equal(first.sensitivity.variants.length, 5);
  assert.equal(first.sensitivity.trialsPerVariant, 500);
  assert.ok(first.sensitivity.range.low <= first.sensitivity.range.high);
  assert.equal(first.sensitivity.span, first.sensitivity.range.high - first.sensitivity.range.low);
  first.rivalDependencies.forEach(item => {
    assert.equal(item.samples + item.complementSamples, input.simulations);
    assert.equal(item.hits + item.complementHits, first.sampleSize);
    assert.ok(['Strong', 'Suggestive', 'Unclear'].includes(item.evidence));
    assert.ok(item.qValue >= 0 && item.qValue <= 1);
  });
  first.gameLeverage.forEach(item => {
    assert.equal(item.samples + item.complementSamples, input.simulations);
    assert.equal(item.hits + item.complementHits, first.sampleSize);
    assert.ok(['Strong', 'Suggestive', 'Unclear'].includes(item.evidence));
    assert.ok(item.qValue >= 0 && item.qValue <= 1);
  });
  first.thresholds.wins.forEach(item => {
    assert.ok(item.confidence95.low <= item.probability);
    assert.ok(item.confidence95.high >= item.probability);
  });
});

test('omits rival comparisons when the complementary condition never occurs', () => {
  const lockedTeams = teams.map((team, index) => ({
    ...team,
    wins: index === 0 ? 14 : team.wins,
    losses: index === 0 ? 0 : team.losses,
    fpts: index === 0 ? 2000 : team.fpts
  }));
  const result = runSimulationExplorer({
    teams: lockedTeams,
    remainingSchedule: [],
    targetName: 'Team12',
    outcome: 'playoff',
    simulations: 100,
    seed: 42
  });

  assert.equal(result.rivalDependencies.some(item => item.rival === 'Team1' && item.condition === 'makes playoffs'), false);
  assert.equal(Object.values(result.routes).reduce((sum, route) => sum + route.count, 0), result.sampleSize);
});
