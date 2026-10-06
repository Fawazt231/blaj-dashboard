import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildHistoricalContext } from './historicalContext.js';

const history = JSON.parse(fs.readFileSync(new URL('../public/data/excel_history.json', import.meta.url)));
const weekFourGames = history.MatchLog_PlayoffIncluded.filter(game => (
  Number(game.season) === 2026 && Number(game.week) === 4
));

test('Week 4 deterministically selects the relevant tables and annotations', () => {
  const input = {
    log: history.MatchLog_PlayoffIncluded,
    recapGames: weekFourGames,
    throughWeek: 4,
    currentSeason: 2026
  };
  const first = buildHistoricalContext(input);
  const second = buildHistoricalContext(input);

  assert.deepEqual(first, second);
  assert.deepEqual(first.tables.map(table => table.label), ['Top five starts']);
  assert.equal(first.tables[0].rows[1].team, 'Nabbo');
  assert.equal(first.tables[0].rows[1].pf, 515.38);
  assert.deepEqual(first.annotations.map(item => item.team), ['Aryan', 'Loomnoo', 'Jaguo']);
  assert.equal(first.cohorts.length, 5);
});

test('Week 4 identifies GeneralSod manager-specific low', () => {
  const context = buildHistoricalContext({
    log: history.MatchLog_PlayoffIncluded,
    recapGames: weekFourGames,
    throughWeek: 4,
    currentSeason: 2026
  });
  const generalSod = context.weeklyExtremes.find(item => item.team === 'GeneralSod');

  assert.ok(generalSod);
  assert.equal(generalSod.score, 60.68);
  assert.equal(generalSod.direction, 'lowest');
  assert.equal(generalSod.rank, 3);
  assert.equal(generalSod.total, 126);
});
