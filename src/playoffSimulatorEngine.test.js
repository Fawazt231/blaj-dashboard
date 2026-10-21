import test from 'node:test';
import assert from 'node:assert/strict';

import { runPlayoffSimulation } from './playoffSimulatorEngine.js';

test('derives missing division groups and awards one winner per division per simulation', () => {
  const teams = [
    { name: 'A1', wins: 4, losses: 0, fpts: 500, division: 1 },
    { name: 'A2', wins: 3, losses: 1, fpts: 450, division: 1 },
    { name: 'B1', wins: 2, losses: 2, fpts: 400, division: 2 },
    { name: 'B2', wins: 1, losses: 3, fpts: 350, division: 2 },
    { name: 'C1', wins: 2, losses: 2, fpts: 390, division: 3 },
    { name: 'C2', wins: 0, losses: 4, fpts: 300, division: 3 }
  ];
  const simulations = 250;
  const results = runPlayoffSimulation({
    teams,
    remainingSchedule: [],
    simulations,
    divisions: {}
  });
  const resultByName = Object.fromEntries(results.map(result => [result.name, result]));

  for (const members of [['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2']]) {
    const divisionWinnerCount = members.reduce(
      (sum, name) => sum + resultByName[name].divWinnerCount,
      0
    );
    assert.equal(divisionWinnerCount, simulations);
  }
});

test('ignores an incomplete explicit division map', () => {
  const teams = [
    { name: 'A1', wins: 1, losses: 0, fpts: 100, division: 1 },
    { name: 'A2', wins: 0, losses: 1, fpts: 90, division: 1 },
    { name: 'B1', wins: 1, losses: 0, fpts: 100, division: 2 },
    { name: 'B2', wins: 0, losses: 1, fpts: 90, division: 2 }
  ];
  const simulations = 100;
  const results = runPlayoffSimulation({
    teams,
    remainingSchedule: [],
    simulations,
    divisions: { 1: ['A1', 'A2'] }
  });

  assert.equal(
    results.reduce((sum, result) => sum + result.divWinnerCount, 0),
    simulations * 2
  );
});

test('uses the current league scoring average as the Bayesian prior', () => {
  const teams = [
    { name: 'A', wins: 1, losses: 0, fpts: 80, division: 1 },
    { name: 'B', wins: 1, losses: 0, fpts: 100, division: 2 }
  ];
  const results = runPlayoffSimulation({
    teams,
    remainingSchedule: [],
    simulations: 1,
    model: 'Bayesian',
    priorStd: 25,
    minSigma: 20
  });
  const byName = Object.fromEntries(results.map(result => [result.name, result]));

  assert.ok(byName.A.mean > 80 && byName.A.mean < 90);
  assert.ok(byName.B.mean < 100 && byName.B.mean > 90);
});

test('uses completed weekly scores to estimate team volatility', () => {
  const teams = [
    { name: 'Volatile', wins: 1, losses: 1, fpts: 200, division: 1, weeklyScores: [50, 150] },
    { name: 'Stable', wins: 1, losses: 1, fpts: 200, division: 2, weeklyScores: [99, 101] }
  ];
  const results = runPlayoffSimulation({
    teams,
    remainingSchedule: [],
    simulations: 1,
    model: 'Bayesian',
    priorStd: 25,
    minSigma: 20
  });
  const byName = Object.fromEntries(results.map(result => [result.name, result]));

  assert.ok(byName.Volatile.std > byName.Stable.std * 2);
});

test('applies a normalized roster projection only to its target week', () => {
  const teams = [
    { name: 'Deep', wins: 1, losses: 0, fpts: 100, division: 1, projectedMean: 120, projectedLeagueMean: 100, projectionWeek: 2 },
    { name: 'Thin', wins: 1, losses: 0, fpts: 100, division: 2, projectedMean: 80, projectedLeagueMean: 100, projectionWeek: 2 }
  ];
  const results = runPlayoffSimulation({
    teams,
    remainingSchedule: [['Deep', 'Thin', 2], ['Deep', 'Thin', 3]],
    simulations: 1,
    model: 'Bayesian',
    priorStd: 15,
    minSigma: 40,
    rosterBlend: 0.5,
    overrides: { 0: 'away', 1: 'away' }
  });
  const byName = Object.fromEntries(results.map(result => [result.name, result]));

  // Week 2 uses blended means of 110/90, then Week 3 returns to 100/100.
  assert.equal(byName.Deep.projFpts, 350);
  assert.equal(byName.Thin.projFpts, 250);
  assert.equal(byName.Deep.mean, 100);
  assert.equal(byName.Thin.mean, 100);
});

test('falls back to the score-only model when a roster projection is missing', () => {
  const teams = [
    { name: 'Known', wins: 1, losses: 0, fpts: 80, division: 1 },
    { name: 'Other', wins: 1, losses: 0, fpts: 100, division: 2 }
  ];
  const baseline = runPlayoffSimulation({ teams, remainingSchedule: [], simulations: 1 });
  const challenger = runPlayoffSimulation({
    teams,
    remainingSchedule: [],
    simulations: 1,
    rosterBlend: 0.5
  });

  const baselineMeans = Object.fromEntries(baseline.map(result => [result.name, result.mean]));
  const challengerMeans = Object.fromEntries(challenger.map(result => [result.name, result.mean]));
  assert.deepEqual(challengerMeans, baselineMeans);
});
