import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildHistoricalContext, mergeCurrentSeasonRegularGames } from './historicalContext.js';

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
  assert.deepEqual(first.annotations.map(item => item.team), ['Aryan']);
  assert.equal(first.annotations[0].displayRank, 10);
  assert.equal(first.cohorts.length, 5);
  assert.deepEqual(first.cohorts[0].championTeams, ["Jaguo '25"]);
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

test('live completed games replace stale current-season history', () => {
  const stale = [
    { season: 2025, week: 1, game_type: 'regular', awayTeamName: 'Old A', homeTeamName: 'Old B' },
    { season: 2026, week: 1, game_type: 'regular', awayTeamName: 'Stale A', homeTeamName: 'Stale B' }
  ];
  const live = [
    { season: 2026, week: 1, game_type: 'regular', awayTeamName: 'Live A', homeTeamName: 'Live B' }
  ];
  const merged = mergeCurrentSeasonRegularGames(stale, live, 2026);

  assert.deepEqual(merged.map(game => game.awayTeamName), ['Old A', 'Live A']);
});

test('Week 4 recognizes Nfi421 reaching an exact 50-50 regular-season record', () => {
  const context = buildHistoricalContext({
    log: history.MatchLog_PlayoffIncluded,
    recapGames: weekFourGames,
    throughWeek: 4,
    currentSeason: 2026
  });

  assert.deepEqual(context.milestones.map(item => item.text), [
    'Nfi421 is exactly 50-50 through 100 regular-season games.'
  ]);
});
