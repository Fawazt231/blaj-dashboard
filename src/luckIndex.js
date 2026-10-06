const normalizeName = value => String(value || '').trim().toLowerCase();

function scoresFromLiveMatchups(matchupsByWeek, throughWeek) {
  const weeklyScores = new Map();

  Object.entries(matchupsByWeek || {}).forEach(([weekValue, pairs]) => {
    const week = Number(weekValue);
    if (!Number.isFinite(week) || week < 1 || week > throughWeek || !Array.isArray(pairs)) return;

    const scores = new Map();
    pairs.forEach(pair => {
      if (!Array.isArray(pair)) return;
      pair.forEach(entry => {
        const team = entry?.team_info || entry;
        const name = normalizeName(team?.canonical_name || team?.display_name);
        const points = Number(entry?.points);
        if (name && Number.isFinite(points)) scores.set(name, points);
      });
    });
    if (scores.size > 1) weeklyScores.set(week, scores);
  });

  return weeklyScores;
}

function scoresFromMatchLog(matchLog, season, throughWeek) {
  const weeklyScores = new Map();

  (matchLog || []).forEach(game => {
    const week = Number(game?.week);
    if (Number(game?.season) !== Number(season) || week < 1 || week > throughWeek) return;
    if (String(game?.game_type || 'regular').toLowerCase() !== 'regular') return;

    if (!weeklyScores.has(week)) weeklyScores.set(week, new Map());
    const scores = weeklyScores.get(week);
    scores.set(normalizeName(game.awayTeamName), Number(game.awayScore || 0));
    scores.set(normalizeName(game.homeTeamName), Number(game.homeScore || 0));
  });

  return weeklyScores;
}

export function calculateLuckRows(standings, {
  matchupsByWeek = {},
  matchLog = [],
  season,
  throughWeek = 0
} = {}) {
  const liveScores = scoresFromLiveMatchups(matchupsByWeek, throughWeek);
  const weeklyScores = liveScores.size > 0
    ? liveScores
    : scoresFromMatchLog(matchLog, season, throughWeek);

  return (standings || []).map(team => {
    const name = normalizeName(team.canonical_name || team.display_name);
    let expectedWins = 0;
    let expectedGames = 0;

    weeklyScores.forEach(scores => {
      if (!scores.has(name) || scores.size < 2) return;
      const teamScore = scores.get(name);
      let opponentsBeaten = 0;
      let opponentsTied = 0;

      scores.forEach((opponentScore, opponentName) => {
        if (opponentName === name) return;
        if (teamScore > opponentScore) opponentsBeaten += 1;
        else if (teamScore === opponentScore) opponentsTied += 1;
      });

      expectedWins += (opponentsBeaten + opponentsTied * 0.5) / (scores.size - 1);
      expectedGames += 1;
    });

    return {
      ...team,
      expectedWins,
      expectedLosses: expectedGames - expectedWins,
      expectedGames,
      luck: Number(team.wins || 0) - expectedWins
    };
  });
}
