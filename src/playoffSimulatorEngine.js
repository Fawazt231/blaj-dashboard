// Monte Carlo Playoff Odds Simulation Engine for Blaj Fantasy League
// Ported directly from Python (playoffPicture.py & streamlit_app.py) to pure JavaScript

// Standard Normal random variate generator (Box-Muller transform)
function randomNormal(mean = 0, std = 1) {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * std;
}

export function runPlayoffSimulation({
  teams,             // list of { name, wins, losses, fpts, roster_id, division }
  remainingSchedule, // list of [awayName, homeName] for unplayed regular season games
  simulations = 5000,
  model = 'Bayesian', // 'Bayesian', 'Simple'
  priorStd = 20.0,
  minSigma = 10.0,
  overrides = {},    // { gameIndex: 'away' | 'home' } for What-If scenario forcing
  divisions = {}     // { div_id: [teamNames] }
}) {
  if (!teams || teams.length === 0) return [];

  // 1. Calculate scoring baselines (mean & std) for each team
  const simTeamsBase = teams.map(t => {
    const totalGames = t.wins + t.losses;
    const rawMean = totalGames > 0 ? t.fpts / totalGames : (t.historicalAvg || 110.0);
    let mean = rawMean;
    let std = Math.max(Math.sqrt(Math.max(rawMean, 1.0)) * 1.5, 16.0);

    const priorMean = 115.0;
    if (model === 'Simple') {
      // 50% current team score average + 50% league average baseline
      mean = 0.5 * rawMean + 0.5 * priorMean;
    } else if (model === 'Bayesian') {
      const priorVar = priorStd * priorStd;
      if (totalGames > 0) {
        const obsVar = Math.max(std * std, minSigma * minSigma);
        const postVar = 1.0 / (1.0 / priorVar + totalGames / obsVar);
        mean = postVar * (priorMean / priorVar + totalGames * rawMean / obsVar);
        std = Math.sqrt(obsVar + postVar);
      } else {
        // Pre-season Bayesian prior using team historical average
        mean = 0.5 * rawMean + 0.5 * priorMean;
        std = priorStd;
      }
    }

    return {
      name: t.name,
      wins: t.wins,
      losses: t.losses,
      fpts: t.fpts,
      mean: mean,
      std: std,
      division: t.division
    };
  });

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
      mean: t.mean,
      std: t.std,
      division: t.division
    }));

    const teamByName = {};
    state.forEach(t => { teamByName[t.name] = t; });

    // Simulate remaining games
    remainingSchedule.forEach((match, idx) => {
      const away = teamByName[match[0]];
      const home = teamByName[match[1]];
      if (!away || !home) return;

      let awayScore = 0;
      let homeScore = 0;

      if (overrides[idx] === 'away') {
        awayScore = away.mean + 20;
        homeScore = home.mean - 20;
      } else if (overrides[idx] === 'home') {
        awayScore = away.mean - 20;
        homeScore = home.mean + 20;
      } else {
        awayScore = randomNormal(away.mean, away.std);
        homeScore = randomNormal(home.mean, home.std);
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
    const divNames = Object.keys(divisions);

    if (divNames.length > 0) {
      divNames.forEach(divId => {
        const members = divisions[divId] || [];
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
