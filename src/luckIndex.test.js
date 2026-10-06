import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateLuckRows } from './luckIndex.js';

const standings = [
  { canonical_name: 'Alpha', wins: 2, losses: 0 },
  { canonical_name: 'Bravo', wins: 1, losses: 1 },
  { canonical_name: 'Charlie', wins: 0, losses: 2 }
];

const matchupsByWeek = {
  1: [[
    { team_info: { canonical_name: 'Alpha' }, points: 120 },
    { team_info: { canonical_name: 'Bravo' }, points: 100 }
  ], [
    { team_info: { canonical_name: 'Charlie' }, points: 80 }
  ]],
  2: [[
    { team_info: { canonical_name: 'Alpha' }, points: 90 },
    { team_info: { canonical_name: 'Charlie' }, points: 110 }
  ], [
    { team_info: { canonical_name: 'Bravo' }, points: 100 }
  ]]
};

test('accumulates all-play expected record one week at a time', () => {
  const rows = calculateLuckRows(standings, { matchupsByWeek, throughWeek: 2 });
  const byName = Object.fromEntries(rows.map(row => [row.canonical_name, row]));

  assert.equal(byName.Alpha.expectedWins, 1);
  assert.equal(byName.Alpha.expectedLosses, 1);
  assert.equal(byName.Bravo.expectedWins, 1);
  assert.equal(byName.Bravo.expectedLosses, 1);
  assert.equal(byName.Charlie.expectedWins, 1);
  assert.equal(byName.Charlie.expectedLosses, 1);
});

test('one additional week changes expected wins by no more than one', () => {
  const afterOne = calculateLuckRows(standings, { matchupsByWeek, throughWeek: 1 });
  const afterTwo = calculateLuckRows(standings, { matchupsByWeek, throughWeek: 2 });

  afterTwo.forEach((row, index) => {
    const expectedWinChange = row.expectedWins - afterOne[index].expectedWins;
    assert.ok(expectedWinChange >= 0 && expectedWinChange <= 1);
    assert.equal(row.expectedWins + row.expectedLosses, 2);
  });
});

test('awards half an all-play result for equal weekly scores', () => {
  const tied = calculateLuckRows(standings.slice(0, 2), {
    throughWeek: 1,
    matchupsByWeek: {
      1: [[
        { team_info: { canonical_name: 'Alpha' }, points: 100 },
        { team_info: { canonical_name: 'Bravo' }, points: 100 }
      ]]
    }
  });

  tied.forEach(row => {
    assert.equal(row.expectedWins, 0.5);
    assert.equal(row.expectedLosses, 0.5);
  });
});
