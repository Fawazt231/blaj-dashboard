import { runPlayoffSimulation } from './playoffSimulatorEngine.js';
import { SIMULATION_MODEL } from './simulationModelConfig.js';

export const EXPLORER_OUTCOMES = ['playoff', 'bye', 'divisionWinner', 'miss', 'last'];

export function createSeededRandom(seed = 231) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const createDistribution = (step = 0.1) => {
  const bins = new Map();
  let count = 0;
  let total = 0;
  const add = value => {
    if (!Number.isFinite(value)) return;
    const key = Math.round(value / step);
    bins.set(key, (bins.get(key) || 0) + 1);
    count += 1;
    total += value;
  };
  const quantile = percentile => {
    if (!count) return null;
    const target = Math.floor((count - 1) * percentile);
    let seen = 0;
    for (const [key, frequency] of [...bins.entries()].sort((a, b) => a[0] - b[0])) {
      seen += frequency;
      if (seen > target) return key * step;
    }
    return null;
  };
  return {
    add,
    summarize: () => ({
      mean: count ? total / count : null,
      p10: quantile(0.1),
      median: quantile(0.5),
      p90: quantile(0.9)
    })
  };
};

const pct = (hits, total) => total ? hits / total * 100 : null;

const wilsonInterval = (hits, total, z = 1.96) => {
  if (!total) return { low: null, high: null };
  const proportion = hits / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total) / denominator;
  return { low: Math.max(0, center - margin) * 100, high: Math.min(1, center + margin) * 100 };
};

const normalCdf = value => {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
};

const twoProportionPValue = (hitsA, totalA, hitsB, totalB) => {
  if (!totalA || !totalB) return 1;
  const probabilityA = hitsA / totalA;
  const probabilityB = hitsB / totalB;
  const pooled = (hitsA + hitsB) / (totalA + totalB);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  if (!standardError) return probabilityA === probabilityB ? 1 : 0;
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(probabilityA - probabilityB) / standardError))));
};

const addFalseDiscoveryRates = rows => {
  const ranked = rows.map((row, index) => ({ row, index })).sort((a, b) => a.row.pValue - b.row.pValue);
  let runningMinimum = 1;
  for (let index = ranked.length - 1; index >= 0; index -= 1) {
    const adjusted = Math.min(1, ranked[index].row.pValue * ranked.length / (index + 1));
    runningMinimum = Math.min(runningMinimum, adjusted);
    ranked[index].row.qValue = runningMinimum;
  }
  return rows;
};

const classifyEvidence = rows => addFalseDiscoveryRates(rows).map(row => {
  const intervalExcludesZero = row.differenceInterval.low > 0 || row.differenceInterval.high < 0;
  const statisticallyClear = row.qValue <= 0.05 && intervalExcludesZero;
  const substantialEffect = Math.abs(row.difference) >= 0.5;
  const wellSupported = Math.min(row.hits, row.complementHits) >= 200;
  return {
    ...row,
    evidence: !statisticallyClear ? 'Unclear' : substantialEffect && wellSupported ? 'Strong' : 'Suggestive'
  };
});

const routeFor = (name, trial) => {
  if (trial.divisionWinners.some(team => team.name === name)) return 'division';
  if (trial.fourthSeed?.name === name) return 'record';
  if (trial.wildcards.some(team => team.name === name)) return 'points';
  return 'miss';
};

const snapshotTrial = (trial, targetName, initialWins) => {
  const target = trial.state.find(team => team.name === targetName);
  const standings = [...trial.state]
    .sort((a, b) => b.wins - a.wins || b.fpts - a.fpts)
    .map((team, index) => ({
      rank: index + 1,
      name: team.name,
      wins: team.wins,
      losses: team.losses,
      fpts: team.fpts,
      playoff: trial.playoffField.some(entry => entry.name === team.name)
    }));
  const seeds = trial.playoffField.map((team, index) => ({
    seed: index + 1,
    name: team.name,
    wins: team.wins,
    losses: team.losses,
    fpts: team.fpts,
    route: routeFor(team.name, trial)
  }));
  return {
    trial: trial.index + 1,
    target: {
      wins: target.wins,
      losses: target.losses,
      remainingWins: target.wins - initialWins,
      fpts: target.fpts,
      route: routeFor(targetName, trial),
      placement: standings.find(row => row.name === targetName)?.rank ?? null
    },
    standings,
    seeds,
    games: trial.gameResults
      .filter(game => game.away === targetName || game.home === targetName)
      .map(game => ({
        index: game.index,
        opponent: game.away === targetName ? game.home : game.away,
        targetScore: game.away === targetName ? game.awayScore : game.homeScore,
        opponentScore: game.away === targetName ? game.homeScore : game.awayScore,
        result: game.winner === targetName ? 'W' : 'L'
      }))
  };
};

const scenarioPath = scenario => scenario.games.map(game => game.result).join('');

const distanceFromTypical = (scenario, medians) => (
  Math.abs(scenario.target.wins - medians.wins)
  + Math.abs(scenario.target.fpts - medians.fpts) / 100
  + Math.abs((scenario.target.placement ?? medians.placement) - medians.placement) / 4
);

const scenarioDiversity = (left, right, ranges) => {
  const leftPath = scenarioPath(left);
  const rightPath = scenarioPath(right);
  const pathLength = Math.max(leftPath.length, rightPath.length, 1);
  let pathDifferences = 0;
  for (let index = 0; index < pathLength; index += 1) {
    if (leftPath[index] !== rightPath[index]) pathDifferences += 1;
  }
  return (left.target.route === right.target.route ? 0 : 2)
    + Math.abs(left.target.wins - right.target.wins) / ranges.wins
    + Math.abs(left.target.fpts - right.target.fpts) / ranges.fpts
    + Math.abs((left.target.placement ?? 0) - (right.target.placement ?? 0)) / 6
    + 2 * pathDifferences / pathLength;
};

const labelScenarios = (scenarios, medians) => {
  const routeLabels = { division: 'Division route', record: 'Record route', points: 'Points route', miss: 'Miss path' };
  const multipleRoutes = new Set(scenarios.map(scenario => scenario.target.route)).size > 1;
  const used = new Set();
  return scenarios.map((scenario, index) => {
    let archetype = index === 0 ? 'Typical' : multipleRoutes ? routeLabels[scenario.target.route] : null;
    if (!archetype) {
      if (scenario.target.wins > medians.wins) archetype = 'More-win path';
      else if (scenario.target.wins < medians.wins) archetype = 'Fewer-win path';
      else if (scenario.target.fpts > medians.fpts) archetype = 'Higher-PF path';
      else if (scenario.target.fpts < medians.fpts) archetype = 'Lower-PF path';
      else archetype = 'Alternative path';
    }
    if (used.has(archetype)) archetype = `Alternative path ${index}`;
    used.add(archetype);
    return { ...scenario, archetype };
  });
};

const selectRepresentativeScenarios = (samples, summaries) => {
  if (!samples.length || summaries.wins.median == null || summaries.fpts.median == null) return [];
  const medians = {
    wins: summaries.wins.median,
    fpts: summaries.fpts.median,
    placement: summaries.placement.median ?? 6.5
  };
  const ranges = {
    wins: Math.max(1, (summaries.wins.p90 ?? medians.wins) - (summaries.wins.p10 ?? medians.wins)),
    fpts: Math.max(50, (summaries.fpts.p90 ?? medians.fpts) - (summaries.fpts.p10 ?? medians.fpts))
  };
  const byTypical = [...samples].sort((a, b) => distanceFromTypical(a, medians) - distanceFromTypical(b, medians) || a.trial - b.trial);
  const selected = [byTypical[0]];
  const selectedTrials = new Set([byTypical[0].trial]);
  const routeGroups = new Map();
  byTypical.forEach(scenario => {
    if (!routeGroups.has(scenario.target.route)) routeGroups.set(scenario.target.route, []);
    routeGroups.get(scenario.target.route).push(scenario);
  });
  [...routeGroups.entries()]
    .filter(([route]) => route !== byTypical[0].target.route)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .forEach(([, group]) => {
      if (selected.length >= 3) return;
      const candidate = group.find(scenario => !selectedTrials.has(scenario.trial));
      if (candidate) {
        selected.push(candidate);
        selectedTrials.add(candidate.trial);
      }
    });
  while (selected.length < Math.min(3, samples.length)) {
    const candidate = byTypical
      .filter(scenario => !selectedTrials.has(scenario.trial))
      .map(scenario => ({
        scenario,
        score: Math.min(...selected.map(chosen => scenarioDiversity(scenario, chosen, ranges)))
          - 0.15 * distanceFromTypical(scenario, medians)
      }))
      .sort((a, b) => b.score - a.score || a.scenario.trial - b.scenario.trial)[0]?.scenario;
    if (!candidate) break;
    selected.push(candidate);
    selectedTrials.add(candidate.trial);
  }
  return labelScenarios(selected, medians);
};

export function runSimulationExplorer({
  teams,
  remainingSchedule,
  targetName,
  outcome = 'playoff',
  simulations = 100000,
  seed = 231,
  model = 'Bayesian',
  priorStd = SIMULATION_MODEL.priorStd,
  minSigma = SIMULATION_MODEL.minSigma,
  divisions = {}
}) {
  if (!EXPLORER_OUTCOMES.includes(outcome)) throw new Error(`Unsupported outcome: ${outcome}`);
  const initial = teams.find(team => team.name === targetName);
  if (!initial) throw new Error(`Unknown team: ${targetName}`);

  const allWins = createDistribution(1);
  const allPf = createDistribution(0.1);
  const allPlacement = createDistribution(1);
  const outcomeWins = createDistribution(1);
  const outcomePf = createDistribution(0.1);
  const outcomePlacement = createDistribution(1);
  const outcomeRemainingWins = createDistribution(1);
  const outcomeCutoffMargins = createDistribution(0.1);
  const routes = { division: 0, record: 0, points: 0, miss: 0 };
  const pathCounts = new Map();
  const samples = [];
  const sampleLimit = 750;
  const sampleRng = createSeededRandom((Number(seed) >>> 0) ^ 0x9e3779b9);
  const gameStats = new Map();
  const rivalStats = new Map(teams.filter(team => team.name !== targetName).map(team => [team.name, {
    trials: 0,
    playoff: 0,
    divisionWinner: 0,
    outcomeAndPlayoff: 0,
    outcomeAndDivisionWinner: 0
  }]));
  const winThresholds = new Map();
  const pfThresholds = new Map();
  let outcomeCount = 0;
  let cutoffComparisons = 0;
  let cutoffAtOrAbove = 0;

  runPlayoffSimulation({
    teams,
    remainingSchedule,
    simulations,
    model,
    priorStd,
    minSigma,
    divisions,
    rng: createSeededRandom(seed),
    onTrial: trial => {
      const target = trial.state.find(team => team.name === targetName);
      const madePlayoffs = trial.playoffField.some(team => team.name === targetName);
      const gotBye = trial.byes.some(team => team.name === targetName);
      const wonDivision = trial.divisionWinners.some(team => team.name === targetName);
      const finishedLast = trial.lastPlace.name === targetName;
      const placement = [...trial.state]
        .sort((a, b) => b.wins - a.wins || b.fpts - a.fpts)
        .findIndex(team => team.name === targetName) + 1;
      const event = outcome === 'playoff' ? madePlayoffs
        : outcome === 'bye' ? gotBye
          : outcome === 'divisionWinner' ? wonDivision
            : outcome === 'miss' ? !madePlayoffs
              : finishedLast;

      allWins.add(target.wins);
      allPf.add(target.fpts);
      allPlacement.add(placement);
      const winBucket = winThresholds.get(target.wins) || { total: 0, outcome: 0 };
      winBucket.total += 1;
      if (event) winBucket.outcome += 1;
      winThresholds.set(target.wins, winBucket);
      const pfFloor = Math.floor(target.fpts / 25) * 25;
      const pfBucket = pfThresholds.get(pfFloor) || { total: 0, outcome: 0 };
      pfBucket.total += 1;
      if (event) pfBucket.outcome += 1;
      pfThresholds.set(pfFloor, pfBucket);

      trial.gameResults.forEach(game => {
        if (game.away !== targetName && game.home !== targetName) return;
        const stat = gameStats.get(game.index) || {
          index: game.index,
          opponent: game.away === targetName ? game.home : game.away,
          wins: 0,
          losses: 0,
          outcomeWithWin: 0,
          outcomeWithLoss: 0
        };
        const targetWon = game.winner === targetName;
        if (targetWon) {
          stat.wins += 1;
          if (event) stat.outcomeWithWin += 1;
        } else {
          stat.losses += 1;
          if (event) stat.outcomeWithLoss += 1;
        }
        gameStats.set(game.index, stat);
      });

      rivalStats.forEach((stat, name) => {
        stat.trials += 1;
        const rivalPlayoff = trial.playoffField.some(team => team.name === name);
        const rivalDivision = trial.divisionWinners.some(team => team.name === name);
        if (rivalPlayoff) stat.playoff += 1;
        if (rivalDivision) stat.divisionWinner += 1;
        if (event && rivalPlayoff) stat.outcomeAndPlayoff += 1;
        if (event && rivalDivision) stat.outcomeAndDivisionWinner += 1;
      });

      if (!event) return;
      outcomeCount += 1;
      outcomeWins.add(target.wins);
      outcomePf.add(target.fpts);
      outcomePlacement.add(placement);
      outcomeRemainingWins.add(target.wins - initial.wins);
      const pointsCutoff = trial.wildcards.at(-1)?.fpts;
      if (Number.isFinite(pointsCutoff)) {
        const cutoffMargin = target.fpts - pointsCutoff;
        outcomeCutoffMargins.add(cutoffMargin);
        cutoffComparisons += 1;
        if (cutoffMargin >= 0) cutoffAtOrAbove += 1;
      }
      routes[routeFor(targetName, trial)] += 1;
      const path = trial.gameResults
        .filter(game => game.away === targetName || game.home === targetName)
        .map(game => game.winner === targetName ? 'W' : 'L')
        .join('');
      pathCounts.set(path, (pathCounts.get(path) || 0) + 1);
      if (samples.length < sampleLimit) {
        samples.push(snapshotTrial(trial, targetName, initial.wins));
      } else {
        const reservoirIndex = Math.floor(sampleRng() * outcomeCount);
        if (reservoirIndex < sampleLimit) samples[reservoirIndex] = snapshotTrial(trial, targetName, initial.wins);
      }
    }
  });

  const baselinePct = pct(outcomeCount, simulations);
  const gameLeverage = classifyEvidence([...gameStats.values()].filter(stat => stat.wins > 0 && stat.losses > 0).map(stat => {
    const withWin = pct(stat.outcomeWithWin, stat.wins);
    const withLoss = pct(stat.outcomeWithLoss, stat.losses);
    const winInterval = wilsonInterval(stat.outcomeWithWin, stat.wins);
    const lossInterval = wilsonInterval(stat.outcomeWithLoss, stat.losses);
    const difference = withWin !== null && withLoss !== null ? withWin - withLoss : null;
    return {
      ...stat,
      hits: stat.outcomeWithWin,
      complementHits: stat.outcomeWithLoss,
      samples: stat.wins,
      complementSamples: stat.losses,
      withWin,
      withLoss,
      leverage: difference,
      difference,
      differenceInterval: {
        low: winInterval.low - lossInterval.high,
        high: winInterval.high - lossInterval.low
      },
      pValue: twoProportionPValue(stat.outcomeWithWin, stat.wins, stat.outcomeWithLoss, stat.losses)
    };
  })).sort((a, b) => Math.abs(b.difference || 0) - Math.abs(a.difference || 0) || b.samples - a.samples);

  const rivalDependencies = classifyEvidence([...rivalStats.entries()].flatMap(([name, stat]) => {
    const rows = [];
    if (stat.playoff > 0 && stat.playoff < simulations) rows.push({ rival: name, condition: 'makes playoffs', samples: stat.playoff, hits: stat.outcomeAndPlayoff });
    if (stat.divisionWinner > 0 && stat.divisionWinner < simulations) rows.push({ rival: name, condition: 'wins division', samples: stat.divisionWinner, hits: stat.outcomeAndDivisionWinner });
    return rows.map(row => {
      const complementSamples = simulations - row.samples;
      const complementHits = outcomeCount - row.hits;
      const probability = pct(row.hits, row.samples);
      const complementProbability = pct(complementHits, complementSamples);
      const conditionInterval = wilsonInterval(row.hits, row.samples);
      const complementInterval = wilsonInterval(complementHits, complementSamples);
      return {
        ...row,
        complementSamples,
        complementHits,
        probability,
        complementProbability,
        lift: probability - baselinePct,
        difference: probability - complementProbability,
        differenceInterval: {
          low: conditionInterval.low - complementInterval.high,
          high: conditionInterval.high - complementInterval.low
        },
        pValue: twoProportionPValue(row.hits, row.samples, complementHits, complementSamples)
      };
    });
  })).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || b.samples - a.samples || a.rival.localeCompare(b.rival));

  const conditionalWinsSummary = outcomeWins.summarize();
  const conditionalPfSummary = outcomePf.summarize();
  const conditionalPlacementSummary = outcomePlacement.summarize();
  const representativeScenarios = selectRepresentativeScenarios(samples, {
    wins: conditionalWinsSummary,
    fpts: conditionalPfSummary,
    placement: conditionalPlacementSummary
  });
  const sensitivityTrials = Math.min(10000, simulations);
  const sensitivitySeed = (Number(seed) >>> 0) ^ 0x85ebca6b;
  const sensitivityVariants = [
    { label: 'Baseline', priorStd, minSigma },
    { label: 'Stronger league pull', priorStd: 10, minSigma },
    { label: 'Stronger team form', priorStd: 25, minSigma },
    { label: 'Lower volatility', priorStd, minSigma: 30 },
    { label: 'Higher volatility', priorStd, minSigma: 50 }
  ];
  const sensitivity = sensitivityVariants.map(variant => {
    const variantResults = runPlayoffSimulation({
      teams,
      remainingSchedule,
      simulations: sensitivityTrials,
      model,
      priorStd: variant.priorStd,
      minSigma: variant.minSigma,
      divisions,
      rng: createSeededRandom(sensitivitySeed)
    });
    const targetResult = variantResults.find(team => team.name === targetName);
    const count = outcome === 'playoff' ? targetResult?.playoffCount
      : outcome === 'bye' ? targetResult?.byeCount
        : outcome === 'divisionWinner' ? targetResult?.divWinnerCount
          : outcome === 'miss' ? sensitivityTrials - Number(targetResult?.playoffCount || 0)
            : targetResult?.lastCount;
    return {
      ...variant,
      count: Number(count || 0),
      probability: pct(Number(count || 0), sensitivityTrials)
    };
  });
  const sensitivityProbabilities = sensitivity.map(item => item.probability).filter(Number.isFinite);
  const sensitivityRange = {
    low: sensitivityProbabilities.length ? Math.min(...sensitivityProbabilities) : null,
    high: sensitivityProbabilities.length ? Math.max(...sensitivityProbabilities) : null
  };

  return {
    targetName,
    outcome,
    simulations,
    seed,
    sampleSize: outcomeCount,
    probability: baselinePct,
    confidence95: wilsonInterval(outcomeCount, simulations),
    sensitivity: {
      trialsPerVariant: sensitivityTrials,
      variants: sensitivity,
      range: sensitivityRange,
      span: sensitivityRange.low == null ? null : sensitivityRange.high - sensitivityRange.low,
      stable: sensitivityRange.low != null && sensitivityRange.high - sensitivityRange.low <= 5
    },
    profile: {
      all: { wins: allWins.summarize(), fpts: allPf.summarize(), placement: allPlacement.summarize() },
      conditional: {
        wins: conditionalWinsSummary,
        remainingWins: outcomeRemainingWins.summarize(),
        fpts: conditionalPfSummary,
        placement: conditionalPlacementSummary,
        pointsCutoffMargin: {
          ...outcomeCutoffMargins.summarize(),
          comparisons: cutoffComparisons,
          atOrAbovePct: pct(cutoffAtOrAbove, cutoffComparisons)
        }
      }
    },
    routes: Object.fromEntries(Object.entries(routes).map(([key, value]) => [key, { count: value, pct: pct(value, outcomeCount) }])),
    gameLeverage,
    rivalDependencies,
    commonPaths: [...pathCounts.entries()]
      .map(([path, count]) => ({ path, count, pct: pct(count, outcomeCount) }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
      .slice(0, 10),
    thresholds: {
      wins: [...winThresholds.entries()].sort((a, b) => a[0] - b[0]).map(([wins, value]) => ({ wins, ...value, probability: pct(value.outcome, value.total), confidence95: wilsonInterval(value.outcome, value.total) })),
      pointsFor: [...pfThresholds.entries()].sort((a, b) => a[0] - b[0]).map(([floor, value]) => ({ floor, ceiling: floor + 24.99, ...value, probability: pct(value.outcome, value.total), confidence95: wilsonInterval(value.outcome, value.total) }))
    },
    representativeScenarios
  };
}
