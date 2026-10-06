const normalize = value => String(value || '').trim().toLowerCase();

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
    if (comparable.length < 5) return null;
    const madePlayoffs = comparable.filter(item => playoffs.some(game => (
      Number(game.season) === item.season && [game.awayTeamName, game.homeTeamName].includes(item.team)
    ))).length;
    const champions = comparable.filter(item => playoffs.some(game => (
      Number(game.season) === item.season && game.is_championship && game.winner === item.team
    ))).length;
    return {
      record,
      teams: teams.map(item => item.team).sort(),
      sampleSize: comparable.length,
      madePlayoffs,
      playoffPct: madePlayoffs / comparable.length * 100,
      champions,
      championshipPct: champions / comparable.length * 100
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
      if (Number(game.season) === currentSeason && Number(game.week) === recapWeek) return;
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
    if (percentile > 0.10) return null;
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
  const cutoff = Math.ceil(entries.length * 0.10);
  const annotations = currentEntries.map(item => {
    const rank = byPf.findIndex(row => row.season === item.season && row.team === item.team) + 1;
    const tailRank = entries.length - rank + 1;
    if (rank > cutoff && tailRank > cutoff) return null;
    return {
      team: item.team,
      pf: item.pf,
      rank,
      total: entries.length,
      direction: rank <= cutoff ? 'highest' : 'lowest',
      extremity: Math.min(rank, tailRank)
    };
  }).filter(item => item && !tableTeams.has(normalize(item.team)))
    .sort((a, b) => a.extremity - b.extremity || a.team.localeCompare(b.team));

  const tables = [];
  if (top.some(item => item.season === currentSeason)) tables.push({ label: 'Top five starts', rows: top });
  if (bottom.some(item => item.season === currentSeason)) tables.push({ label: 'Bottom five starts', rows: bottom });

  const cohorts = buildCohorts(entries, playoffs, currentSeason);
  const weeklyExtremes = buildWeeklyExtremes(log, recapGames, currentSeason, throughWeek);

  return {
    tables,
    annotations,
    cohorts,
    weeklyExtremes,
    hasContent: tables.length > 0 || annotations.length > 0 || cohorts.length > 0 || weeklyExtremes.length > 0
  };
}
