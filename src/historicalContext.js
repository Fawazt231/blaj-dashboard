const normalize = value => String(value || '').trim().toLowerCase();

export const shouldShowCohortTable = cohorts => (
  Array.isArray(cohorts) && cohorts.length > 0 && cohorts.length <= 5
);

export function getHeadToHeadWinStreak(log, teamA, teamB) {
  const a = normalize(teamA);
  const b = normalize(teamB);
  const games = (log || []).filter(game => {
    const away = normalize(game.awayTeamName);
    const home = normalize(game.homeTeamName);
    return (away === a && home === b) || (away === b && home === a);
  }).sort((x, y) => Number(y.season) - Number(x.season) || Number(y.week) - Number(x.week));

  const winner = games[0]?.winner;
  if (!winner) return null;
  let wins = 0;
  for (const game of games) {
    if (normalize(game.winner) !== normalize(winner)) break;
    wins += 1;
  }
  return wins >= 5 ? { team: winner, wins } : null;
}

const ordinal = value => {
  const n = Number(value);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
};

const playoffRound = (season, week) => {
  const rounds = Number(season) <= 2020
    ? { 14: 'Quarters', 15: 'Semis', 16: 'Finals' }
    : { 15: 'Quarters', 16: 'Semis', 17: 'Finals' };
  return rounds[Number(week)] || 'Playoffs';
};

export function mergeCurrentSeasonRegularGames(log, liveGames, currentSeason) {
  return [
    ...(log || []).filter(game => !(
      Number(game.season) === Number(currentSeason)
      && String(game.game_type || 'regular').toLowerCase() === 'regular'
    )),
    ...(liveGames || [])
  ];
}

function buildStarts(log, throughWeek, currentSeason) {
  const regular = log.filter(game => String(game.game_type || 'regular').toLowerCase() === 'regular');
  const playoffs = log.filter(game => String(game.game_type || '').toLowerCase() === 'playoff');
  const full = new Map();
  const starts = new Map();
  const key = (season, team) => `${season}|${team}`;

  regular.forEach(game => {
    const season = Number(game.season);
    ['away', 'home'].forEach(side => {
      const team = game[`${side}TeamName`];
      if (!team) return;
      const id = key(season, team);
      const points = Number(game[`${side}Score`] || 0);
      const total = full.get(id) || { season, team, wins: 0, losses: 0, ties: 0, pf: 0, games: 0 };
      total.games += 1;
      total.pf += points;
      if (game.winner === team) total.wins += 1;
      else if (game.loser === team) total.losses += 1;
      else total.ties += 1;
      full.set(id, total);

      if (Number(game.week) <= throughWeek) {
        const start = starts.get(id) || { season, team, wins: 0, losses: 0, ties: 0, pf: 0, games: 0 };
        start.games += 1;
        start.pf += points;
        if (game.winner === team) start.wins += 1;
        else if (game.loser === team) start.losses += 1;
        else start.ties += 1;
        starts.set(id, start);
      }
    });
  });

  const seasonRanks = new Map();
  [...new Set([...full.values()].map(item => item.season))].forEach(season => {
    [...full.values()]
      .filter(item => item.season === season)
      .sort((a, b) => b.wins - a.wins || b.pf - a.pf)
      .forEach((item, index) => seasonRanks.set(key(season, item.team), index + 1));
  });

  const outcome = item => {
    const total = full.get(key(item.season, item.team));
    const record = `${total.wins}-${total.losses}${total.ties ? `-${total.ties}` : ''}`;
    if (item.season === currentSeason) return `Current ${record}`;
    const games = playoffs.filter(game => Number(game.season) === item.season && [game.awayTeamName, game.homeTeamName].includes(item.team));
    const finish = ordinal(seasonRanks.get(key(item.season, item.team)));
    if (!games.length) return `${finish}, ${record}; missed playoffs`;
    const final = games.find(game => game.is_championship);
    if (final) return `${finish}, ${record}; ${final.winner === item.team ? 'Champion' : 'Finalist'}`;
    const deepest = [...games].sort((a, b) => Number(b.week) - Number(a.week))[0];
    return `${finish}, ${record}; ${playoffRound(item.season, deepest.week)}`;
  };

  const entries = [...starts.values()]
    .filter(item => item.games === throughWeek)
    .map(item => ({ ...item, outcome: outcome(item) }));

  return { entries, playoffs, regular };
}

function buildCohorts(entries, playoffs, currentSeason) {
  const current = entries.filter(item => item.season === currentSeason);
  const completed = entries.filter(item => item.season < currentSeason);
  const currentGroups = new Map();

  current.forEach(item => {
    const id = `${item.wins}-${item.losses}${item.ties ? `-${item.ties}` : ''}`;
    if (!currentGroups.has(id)) currentGroups.set(id, []);
    currentGroups.get(id).push(item);
  });

  return [...currentGroups.entries()].map(([record, teams]) => {
    const comparable = completed.filter(item => (
      item.wins === teams[0].wins && item.losses === teams[0].losses && item.ties === teams[0].ties
    ));
    if (!comparable.length) return null;
    const madePlayoffs = comparable.filter(item => playoffs.some(game => (
      Number(game.season) === item.season && [game.awayTeamName, game.homeTeamName].includes(item.team)
    ))).length;
    const championEntries = comparable.filter(item => playoffs.some(game => (
      Number(game.season) === item.season && game.is_championship && game.winner === item.team
    )));
    const champions = championEntries.length;
    return {
      record,
      teams: teams.map(item => item.team).sort(),
      sampleSize: comparable.length,
      madePlayoffs,
      playoffPct: madePlayoffs / comparable.length * 100,
      champions,
      championshipPct: champions / comparable.length * 100,
      championTeams: championEntries
        .map(item => `${item.team} '${String(item.season).slice(-2)}`)
        .sort()
    };
  }).filter(Boolean).sort((a, b) => Number(b.record.split('-')[0]) - Number(a.record.split('-')[0]));
}

function buildWeeklyExtremes(log, recapGames, currentSeason, recapWeek) {
  const regular = log.filter(game => String(game.game_type || 'regular').toLowerCase() === 'regular');
  const currentScores = [];
  recapGames.forEach(game => {
    if (game.awayTeamName) currentScores.push({ team: game.awayTeamName, score: Number(game.awayScore || 0) });
    if (game.homeTeamName) currentScores.push({ team: game.homeTeamName, score: Number(game.homeScore || 0) });
  });

  return currentScores.map(current => {
    const previous = [];
    regular.forEach(game => {
      if (Number(game.season) === currentSeason && Number(game.week) >= recapWeek) return;
      if (normalize(game.awayTeamName) === normalize(current.team)) previous.push(Number(game.awayScore || 0));
      if (normalize(game.homeTeamName) === normalize(current.team)) previous.push(Number(game.homeScore || 0));
    });
    const total = previous.length + 1;
    if (total < 10) return null;
    const lowRank = 1 + previous.filter(score => score < current.score).length;
    const highRank = 1 + previous.filter(score => score > current.score).length;
    const direction = lowRank <= highRank ? 'lowest' : 'highest';
    const rank = Math.min(lowRank, highRank);
    const percentile = rank / total;
    if (rank > 10) return null;
    return {
      team: current.team,
      score: current.score,
      direction,
      rank,
      ordinalRank: ordinal(rank),
      total,
      percentile
    };
  }).filter(Boolean).sort((a, b) => a.percentile - b.percentile || a.rank - b.rank || a.team.localeCompare(b.team)).slice(0, 6);
}

export function buildPointsAllowedExtremes(log, throughWeek, currentSeason) {
  const totals = new Map();
  const regular = (log || []).filter(game => (
    String(game.game_type || 'regular').toLowerCase() === 'regular'
    && Number(game.week) <= Number(throughWeek)
  ));

  regular.forEach(game => {
    const season = Number(game.season);
    [
      [game.awayTeamName, Number(game.homeScore)],
      [game.homeTeamName, Number(game.awayScore)]
    ].forEach(([team, pointsAllowed]) => {
      if (!team || !Number.isFinite(pointsAllowed)) return;
      const id = `${season}|${normalize(team)}`;
      const total = totals.get(id) || { season, team, pointsAllowed: 0, games: 0 };
      total.pointsAllowed += pointsAllowed;
      total.games += 1;
      totals.set(id, total);
    });
  });

  const entries = [...totals.values()].filter(item => item.games === Number(throughWeek));
  return entries.filter(item => item.season === Number(currentSeason)).map(item => {
    const lowRank = 1 + entries.filter(other => other.pointsAllowed < item.pointsAllowed).length;
    const highRank = 1 + entries.filter(other => other.pointsAllowed > item.pointsAllowed).length;
    const direction = lowRank <= highRank ? 'lowest' : 'highest';
    const rank = Math.min(lowRank, highRank);
    if (rank > 10) return null;
    return {
      ...item,
      direction,
      rank,
      total: entries.length,
      average: item.pointsAllowed / item.games
    };
  }).filter(Boolean).sort((a, b) => a.rank - b.rank || a.team.localeCompare(b.team));
}

export function buildStretchExtremes(log, currentSeason, throughWeek) {
  const performances = new Map();

  (log || []).forEach(game => {
    const season = Number(game.season);
    const week = Number(game.week);
    const gameType = String(game.game_type || 'regular').toLowerCase();
    if (!['regular', 'playoff'].includes(gameType)) return;
    if (!Number.isFinite(season) || !Number.isFinite(week) || season > Number(currentSeason)) return;
    if (season === Number(currentSeason) && week > Number(throughWeek)) return;

    ['away', 'home'].forEach(side => {
      const team = game[`${side}TeamName`];
      const points = Number(game[`${side}Score`]);
      if (!team || !Number.isFinite(points)) return;
      const id = `${season}|${normalize(team)}`;
      const group = performances.get(id) || { season, team, scores: new Map() };
      group.scores.set(week, points);
      performances.set(id, group);
    });
  });

  const windowsByLength = new Map([2, 3, 4].map(length => [length, []]));
  performances.forEach(group => {
    const scores = [...group.scores.entries()]
      .map(([week, points]) => ({ week, points }))
      .sort((a, b) => a.week - b.week);

    windowsByLength.forEach((windows, length) => {
      for (let index = 0; index <= scores.length - length; index += 1) {
        const slice = scores.slice(index, index + length);
        if (!slice.every((item, offset) => item.week === slice[0].week + offset)) continue;
        windows.push({
          season: group.season,
          team: group.team,
          length,
          startWeek: slice[0].week,
          endWeek: slice[slice.length - 1].week,
          points: slice.reduce((sum, item) => sum + item.points, 0)
        });
      }
    });
  });

  const candidates = [];
  windowsByLength.forEach((windows, length) => {
    windows.filter(item => (
      item.season === Number(currentSeason) && item.endWeek === Number(throughWeek)
    )).forEach(current => {
      const lowRank = 1 + windows.filter(item => item.points < current.points).length;
      const highRank = 1 + windows.filter(item => item.points > current.points).length;
      const direction = lowRank <= highRank ? 'lowest' : 'highest';
      const rank = Math.min(lowRank, highRank);
      if (rank > 10) return;
      candidates.push({
        ...current,
        direction,
        rank,
        total: windows.length,
        percentile: rank / windows.length,
        length
      });
    });
  });

  const selected = [];
  const seenTeams = new Set();
  candidates
    .sort((a, b) => a.rank - b.rank || b.length - a.length || a.percentile - b.percentile || a.team.localeCompare(b.team))
    .forEach(item => {
      const id = normalize(item.team);
      if (selected.length >= 6 || seenTeams.has(id)) return;
      seenTeams.add(id);
      selected.push(item);
    });
  return selected;
}

export function buildSeasonWinStreaks(log, currentSeason, throughWeek) {
  const groups = new Map();
  const relevantGames = (log || []).filter(game => {
    const season = Number(game.season);
    const week = Number(game.week);
    const type = String(game.game_type || 'regular').toLowerCase();
    return ['regular', 'playoff'].includes(type)
      && season <= Number(currentSeason)
      && !(season === Number(currentSeason) && week > Number(throughWeek));
  });

  relevantGames.forEach(game => {
    ['away', 'home'].forEach(side => {
      const team = game[`${side}TeamName`];
      if (!team) return;
      const id = `${game.season}|${normalize(team)}`;
      const group = groups.get(id) || { season: Number(game.season), team, games: [] };
      group.games.push({
        week: Number(game.week),
        won: normalize(game.winner) === normalize(team)
      });
      groups.set(id, group);
    });
  });

  const summaries = [...groups.values()].map(group => {
    let activeStreak = 0;
    let maxStreak = 0;
    let running = 0;
    group.games.sort((a, b) => a.week - b.week).forEach(game => {
      running = game.won ? running + 1 : 0;
      maxStreak = Math.max(maxStreak, running);
    });
    for (let index = group.games.length - 1; index >= 0 && group.games[index].won; index -= 1) activeStreak += 1;
    return { ...group, activeStreak, maxStreak };
  });

  const historical = summaries.filter(item => item.season < Number(currentSeason));
  return summaries.filter(item => (
    item.season === Number(currentSeason) && item.activeStreak >= 6
  )).map(current => {
    const comparable = historical.filter(item => item.maxStreak >= current.activeStreak);
    const madePlayoffs = comparable.filter(item => relevantGames.some(game => (
      Number(game.season) === item.season
      && String(game.game_type || '').toLowerCase() === 'playoff'
      && [game.awayTeamName, game.homeTeamName].some(team => normalize(team) === normalize(item.team))
    ))).length;
    const finalists = comparable.filter(item => relevantGames.some(game => (
      Number(game.season) === item.season
      && game.is_championship
      && [game.awayTeamName, game.homeTeamName].some(team => normalize(team) === normalize(item.team))
    ))).length;
    const champions = comparable.filter(item => relevantGames.some(game => (
      Number(game.season) === item.season
      && game.is_championship
      && normalize(game.winner) === normalize(item.team)
    ))).length;
    return {
      team: current.team,
      streak: current.activeStreak,
      sampleSize: comparable.length,
      madePlayoffs,
      finalists,
      champions
    };
  }).sort((a, b) => b.streak - a.streak || a.team.localeCompare(b.team));
}

function buildCareerMilestones(log, recapGames, currentSeason, recapWeek) {
  const currentManagers = new Set();
  recapGames.forEach(game => {
    if (game.awayTeamName) currentManagers.add(normalize(game.awayTeamName));
    if (game.homeTeamName) currentManagers.add(normalize(game.homeTeamName));
  });

  const records = new Map();
  log.filter(game => String(game.game_type || 'regular').toLowerCase() === 'regular').forEach(game => {
    if (Number(game.season) > currentSeason) return;
    if (Number(game.season) === currentSeason && Number(game.week) > recapWeek) return;
    [game.awayTeamName, game.homeTeamName].forEach(team => {
      const id = normalize(team);
      if (!currentManagers.has(id)) return;
      const record = records.get(id) || { team, wins: 0, losses: 0, ties: 0, games: 0 };
      record.games += 1;
      if (normalize(game.winner) === id) record.wins += 1;
      else if (normalize(game.loser) === id) record.losses += 1;
      else record.ties += 1;
      records.set(id, record);
    });
  });

  return [...records.values()].filter(record => (
    record.games >= 50 && record.games % 10 === 0 && record.wins === record.losses && record.ties === 0
  )).map(record => ({
    ...record,
    text: `${record.team} is exactly ${record.wins}-${record.losses} through ${record.games} regular-season games.`
  })).sort((a, b) => b.games - a.games || a.team.localeCompare(b.team));
}

export function buildHistoricalContext({ log = [], recapGames = [], throughWeek, currentSeason }) {
  const { entries, playoffs } = buildStarts(log, throughWeek, currentSeason);
  const byPf = [...entries].sort((a, b) => b.pf - a.pf);
  const top = byPf.slice(0, 5);
  const bottom = [...entries].sort((a, b) => a.pf - b.pf).slice(0, 5);
  const currentEntries = entries.filter(item => item.season === currentSeason);
  const tableTeams = new Set([
    ...top.filter(item => item.season === currentSeason).map(item => normalize(item.team)),
    ...bottom.filter(item => item.season === currentSeason).map(item => normalize(item.team))
  ]);
  const annotations = currentEntries.map(item => {
    const rank = byPf.findIndex(row => row.season === item.season && row.team === item.team) + 1;
    const tailRank = entries.length - rank + 1;
    if (rank > 10 && tailRank > 10) return null;
    return {
      team: item.team,
      pf: item.pf,
      rank,
      total: entries.length,
      direction: rank <= 10 ? 'highest' : 'lowest',
      extremity: Math.min(rank, tailRank),
      displayRank: Math.min(rank, tailRank)
    };
  }).filter(item => item && !tableTeams.has(normalize(item.team)))
    .sort((a, b) => a.extremity - b.extremity || a.team.localeCompare(b.team));

  const tables = [];
  if (top.some(item => item.season === currentSeason)) tables.push({ label: 'Top five starts', rows: top });
  if (bottom.some(item => item.season === currentSeason)) tables.push({ label: 'Bottom five starts', rows: bottom });

  const cohorts = buildCohorts(entries, playoffs, currentSeason);
  const weeklyExtremes = buildWeeklyExtremes(log, recapGames, currentSeason, throughWeek);
  const pointsAllowedExtremes = buildPointsAllowedExtremes(log, throughWeek, currentSeason);
  const stretchExtremes = buildStretchExtremes(log, currentSeason, throughWeek);
  const winStreaks = buildSeasonWinStreaks(log, currentSeason, throughWeek);
  const milestones = buildCareerMilestones(log, recapGames, currentSeason, throughWeek);

  return {
    tables,
    annotations,
    cohorts,
    weeklyExtremes,
    pointsAllowedExtremes,
    stretchExtremes,
    winStreaks,
    milestones,
    hasContent: tables.length > 0 || annotations.length > 0 || cohorts.length > 0 || weeklyExtremes.length > 0 || pointsAllowedExtremes.length > 0 || stretchExtremes.length > 0 || winStreaks.length > 0 || milestones.length > 0
  };
}
