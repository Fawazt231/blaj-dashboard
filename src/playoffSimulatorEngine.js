// Monte Carlo Playoff Odds Simulation Engine for Blaj Fantasy League
// Ported directly from Python (playoffPicture.py & streamlit_app.py) to pure JavaScript

// Standard Normal random variate generator (Box-Muller transform)
function randomNormal(mean = 0, std = 1, rng = Math.random) {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = rng();
  while (u2 === 0) u2 = rng();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * std;
}

function deriveDivisionGroups(teams) {
  return teams.reduce((groups, team) => {
    const divisionId = String(team.division ?? 1);
    if (!groups[divisionId]) groups[divisionId] = [];
    groups[divisionId].push(team.name);
    return groups;
  }, {});
}

function isCompleteDivisionMap(divisions, teams) {
  if (!divisions || typeof divisions !== 'object' || Array.isArray(divisions)) return false;

  const members = Object.values(divisions).flatMap(group => Array.isArray(group) ? group : []);
  const teamNames = teams.map(team => team.name);
  const knownTeams = new Set(teamNames);

  return members.length === teamNames.length
    && new Set(members).size === teamNames.length
    && members.every(name => knownTeams.has(name));
}

export function buildSimulationTeamProfiles({
  teams,
  model = 'Bayesian',
  priorStd = 20.0,
  minSigma = 10.0,
  scoreModel = 'legacy',
  weeklySigma = 20.0,
  volatilityPriorGames = 8
}) {
  const scoredGames = teams.reduce((sum, team) => sum + Math.max(0, Number(team.wins || 0) + Number(team.losses || 0)), 0);
  const scoredPoints = teams.reduce((sum, team) => sum + Number(team.fpts || 0), 0);
  const leagueMean = scoredGames > 0 ? scoredPoints / scoredGames : 115.0;

  return teams.map(t => {
    const totalGames = Number(t.wins || 0) + Number(t.losses || 0);
    const rawMean = totalGames > 0 ? Number(t.fpts || 0) / totalGames : (t.historicalAvg || 110.0);
    let mean = rawMean;
    const weeklyScores = Array.isArray(t.weeklyScores)
      ? t.weeklyScores.map(Number).filter(Number.isFinite)
      : [];
    const weeklyMean = weeklyScores.length
      ? weeklyScores.reduce((sum, score) => sum + score, 0) / weeklyScores.length
      : rawMean;
    const observedVariance = weeklyScores.length >= 2
      ? weeklyScores.reduce((sum, score) => sum + (score - weeklyMean) ** 2, 0) / (weeklyScores.length - 1)
      : null;
    const observedStd = observedVariance == null ? null : Math.sqrt(observedVariance);
    let std = observedStd ?? Math.max(Math.sqrt(Math.max(rawMean, 1.0)) * 1.5, 16.0);
    let strengthStd = 0;

    const priorMean = leagueMean;
    if (model === 'Simple') {
      mean = 0.5 * rawMean + 0.5 * priorMean;
    } else if (model === 'Bayesian') {
      const priorVar = priorStd * priorStd;
      if (totalGames > 0) {
        const evidenceVar = Math.max((observedVariance ?? std * std), minSigma * minSigma);
        const postVar = 1.0 / (1.0 / priorVar + totalGames / evidenceVar);
        mean = postVar * (priorMean / priorVar + totalGames * rawMean / evidenceVar);
        strengthStd = Math.sqrt(postVar);
        if (scoreModel === 'legacy') std = Math.sqrt(evidenceVar + postVar);
      } else {
        mean = 0.5 * rawMean + 0.5 * priorMean;
        strengthStd = priorStd;
      }
    }

    if (scoreModel === 'hierarchical') {
      const priorGames = Math.max(0, Number(volatilityPriorGames) || 0);
      const targetVariance = Math.max(1, Number(weeklySigma) || 20) ** 2;
      const observedDegrees = observedVariance == null ? 0 : Math.max(1, weeklyScores.length - 1);
      const predictiveVariance = (priorGames * targetVariance + observedDegrees * (observedVariance ?? targetVariance))
        / Math.max(1, priorGames + observedDegrees);
      std = Math.sqrt(predictiveVariance);
    }

    const projectedMean = Number(t.projectedMean);
    const projectedLeagueMean = Number(t.projectedLeagueMean);
    const rosterMean = Number.isFinite(projectedMean)
      ? (Number.isFinite(projectedLeagueMean)
          ? leagueMean + projectedMean - projectedLeagueMean
          : projectedMean)
      : null;

    return {
      name: t.name,
      wins: Number(t.wins || 0),
      losses: Number(t.losses || 0),
      fpts: Number(t.fpts || 0),
      mean,
      std,
      strengthStd,
      rosterMean,
      projectionWeek: Number(t.projectionWeek),
      division: t.division
    };
  });
}

export function runPlayoffSimulation({
  teams,             // list of { name, wins, losses, fpts, roster_id, division }
  remainingSchedule, // list of [awayName, homeName] for unplayed regular season games
  simulations = 5000,
  model = 'Bayesian', // 'Bayesian', 'Simple'
  priorStd = 20.0,
  minSigma = 10.0,
  scoreModel = 'legacy',
  weeklySigma = 20.0,
  volatilityPriorGames = 8,
  rosterBlend = 0,
  overrides = {},    // { gameIndex: 'away' | 'home' } for What-If scenario forcing
  divisions = {},    // { div_id: [teamNames] }
  rng = Math.random, // injectable RNG for deterministic diagnostics
  onTrial = null     // optional callback for conditional simulation analysis
}) {
  if (!teams || teams.length === 0) return [];

  // 1. Calculate team-strength posteriors and weekly score volatility.
  const simTeamsBase = buildSimulationTeamProfiles({
    teams,
    model,
    priorStd,
    minSigma,
    scoreModel,
    weeklySigma,
    volatilityPriorGames
  });

  // The live payload stores division membership on each team and may not include
  // a top-level divisions map. Derive it here so the simulator always awards
  // exactly one division title per division. Preserve a complete explicit map
  // for backwards compatibility with callers that provide one.
  const divisionGroups = isCompleteDivisionMap(divisions, simTeamsBase)
    ? divisions
    : deriveDivisionGroups(simTeamsBase);

  // Track qualification counts across N simulations
  const playoffCounts = {};
  const byeCounts = {};
  const divWinnerCounts = {};
  const lastCounts = {};
  const totalWins = {};
  const totalFpts = {};

  simTeamsBase.forEach(t => {
    playoffCounts[t.name] = 0;
    byeCounts[t.name] = 0;
    divWinnerCounts[t.name] = 0;
    lastCounts[t.name] = 0;
    totalWins[t.name] = 0;
    totalFpts[t.name] = 0;
  });

  // Run N Monte Carlo Simulations
  for (let s = 0; s < simulations; s++) {
    // Clone baseline teams for current simulation iteration
    const state = simTeamsBase.map(t => ({
      name: t.name,
      wins: t.wins,
      losses: t.losses,
      fpts: t.fpts,
      // Team-strength uncertainty is shared across every remaining week in a
      // hierarchical trial instead of being reintroduced as weekly noise.
      mean: scoreModel === 'hierarchical' && t.strengthStd > 0
        ? randomNormal(t.mean, t.strengthStd, rng)
        : t.mean,
      std: t.std,
      rosterMean: t.rosterMean,
      projectionWeek: t.projectionWeek,
      division: t.division
    }));

    const teamByName = {};
    state.forEach(t => { teamByName[t.name] = t; });
    const gameResults = onTrial ? [] : null;

    // Simulate remaining games
    remainingSchedule.forEach((match, idx) => {
      const away = teamByName[match[0]];
      const home = teamByName[match[1]];
      if (!away || !home) return;

      const gameWeek = Number(match[2]);
      const blend = Math.min(1, Math.max(0, Number(rosterBlend)));
      const meanForGame = team => (
        blend > 0
        && Number.isFinite(gameWeek)
        && gameWeek === team.projectionWeek
        && Number.isFinite(team.rosterMean)
      ) ? (1 - blend) * team.mean + blend * team.rosterMean : team.mean;
      const awayMean = meanForGame(away);
      const homeMean = meanForGame(home);

      let awayScore = 0;
      let homeScore = 0;

      if (overrides[idx] === 'away') {
        awayScore = awayMean + 20;
        homeScore = homeMean - 20;
      } else if (overrides[idx] === 'home') {
        awayScore = awayMean - 20;
        homeScore = homeMean + 20;
      } else {
        awayScore = randomNormal(awayMean, away.std, rng);
        homeScore = randomNormal(homeMean, home.std, rng);
      }

      away.fpts += awayScore;
      home.fpts += homeScore;

      if (awayScore > homeScore) {
        away.wins += 1;
        home.losses += 1;
      } else {
        home.wins += 1;
        away.losses += 1;
      }
      if (gameResults) {
        gameResults.push({
          index: idx,
          away: away.name,
          home: home.name,
          awayScore,
          homeScore,
          winner: awayScore > homeScore ? away.name : home.name
        });
      }
    });

    // Accumulate running totals for averages
    state.forEach(t => {
      totalWins[t.name] += t.wins;
      totalFpts[t.name] += t.fpts;
    });

    // Determine Last Place (Punishment Watch)
    const sortedByRecord = [...state].sort((a, b) => {
      if (a.wins !== b.wins) return a.wins - b.wins;
      return a.fpts - b.fpts;
    });
    lastCounts[sortedByRecord[0].name] += 1;

    // Determine Division Winners (3 seeds)
    const divWinners = [];
    const divNames = Object.keys(divisionGroups);

    if (divNames.length > 0) {
      divNames.forEach(divId => {
        const members = divisionGroups[divId] || [];
        const divTeams = state.filter(t => members.includes(t.name));
        if (divTeams.length > 0) {
          divTeams.sort((a, b) => {
            if (a.wins !== b.wins) return b.wins - a.wins;
            return b.fpts - a.fpts;
          });
          divWinners.push(divTeams[0]);
          divWinnerCounts[divTeams[0].name] += 1;
        }
      });
    } else {
      // Fallback if divisions missing: top 3 by wins/points
      const sorted = [...state].sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        return b.fpts - a.fpts;
      });
      sorted.slice(0, 3).forEach(w => {
        divWinners.push(w);
        divWinnerCounts[w.name] += 1;
      });
    }

    // Top 2 Division Winners get Byes (Seeds 1 & 2)
    divWinners.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      return b.fpts - a.fpts;
    });
    const topTwoByes = divWinners.slice(0, 2);
    topTwoByes.forEach(b => { byeCounts[b.name] += 1; });

    // Pool of remaining teams (excluding division winners)
    const pool = state.filter(t => !divWinners.some(w => w.name === t.name));
    
    // Fourth Seed = best record among pool
    pool.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      return b.fpts - a.fpts;
    });
    const fourthSeed = pool.length > 0 ? [pool[0]] : [];

    // Wildcards = next 2 best by Total Score (Points For) among remaining pool
    const poolRemaining = pool.slice(1);
    poolRemaining.sort((a, b) => b.fpts - a.fpts);
    const wildcards = poolRemaining.slice(0, 2);

    // Full 6-Team Playoff Field
    const playoffField = [...divWinners, ...fourthSeed, ...wildcards];
    playoffField.forEach(p => {
      playoffCounts[p.name] += 1;
    });

    if (onTrial) {
      onTrial({
        index: s,
        state,
        gameResults,
        lastPlace: sortedByRecord[0],
        divisionWinners: divWinners,
        byes: topTwoByes,
        fourthSeed: fourthSeed[0] || null,
        wildcards,
        playoffField
      });
    }
  }

  // Calculate percentage odds and raw instance counts
  const results = simTeamsBase.map(t => {
    return {
      name: t.name,
      playoffCount: playoffCounts[t.name],
      playoffPct: Number(((playoffCounts[t.name] / simulations) * 100).toFixed(1)),
      byeCount: byeCounts[t.name],
      byePct: Number(((byeCounts[t.name] / simulations) * 100).toFixed(1)),
      divWinnerCount: divWinnerCounts[t.name],
      divWinnerPct: Number(((divWinnerCounts[t.name] / simulations) * 100).toFixed(1)),
      lastCount: lastCounts[t.name],
      lastPct: Number(((lastCounts[t.name] / simulations) * 100).toFixed(1)),
      projWins: Number((totalWins[t.name] / simulations).toFixed(1)),
      projFpts: Number((totalFpts[t.name] / simulations).toFixed(1)),
      mean: t.mean,
      std: t.std
    };
  });

  // Sort results by Playoff Odds DESC, then Projected Wins DESC
  results.sort((a, b) => {
    if (b.playoffPct !== a.playoffPct) return b.playoffPct - a.playoffPct;
    return b.projWins - a.projWins;
  });

  return results;
}
