import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = process.env.CANDIDATE_EVALUATION_OUTPUT
  ? path.resolve(root, process.env.CANDIDATE_EVALUATION_OUTPUT)
  : path.join(root, 'data/roster_playoff_evaluation.json');
const specs = process.argv.slice(2).map(argument => {
  const separator = argument.indexOf('=');
  if (separator < 1) throw new Error(`Expected label=path, received ${argument}`);
  return { label: argument.slice(0, separator), file: argument.slice(separator + 1) };
});
if (specs.length < 2) throw new Error('Provide a baseline and at least one challenger as label=path arguments.');

const outcomes = ['playoff', 'bye', 'divisionWinner', 'last'];
const clamp = value => Math.min(1 - 1e-6, Math.max(1e-6, value));
const round = (value, digits = 6) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

function score(rows, outcome = null) {
  const selectedOutcomes = outcome ? [outcome] : outcomes;
  let squaredError = 0;
  let logLoss = 0;
  let forecasts = 0;
  rows.forEach(row => selectedOutcomes.forEach(key => {
    const probability = row[key] / 100;
    const actual = Number(row.actual[key]);
    squaredError += (probability - actual) ** 2;
    const bounded = clamp(probability);
    logLoss -= actual * Math.log(bounded) + (1 - actual) * Math.log(1 - bounded);
    forecasts += 1;
  }));
  return { forecasts, brier: squaredError / forecasts, logLoss: logLoss / forecasts };
}

const candidates = [];
for (const spec of specs) {
  const data = JSON.parse(await fs.readFile(path.resolve(root, spec.file), 'utf8'));
  const seasons = [...new Set(data.forecasts.map(row => row.season))].sort();
  candidates.push({
    label: spec.label,
    source: spec.file,
    modelParameters: data.modelParameters,
    simulationsPerCheckpoint: data.simulationsPerCheckpoint,
    overall: score(data.forecasts),
    byOutcome: Object.fromEntries(outcomes.map(outcome => [outcome, score(data.forecasts, outcome)])),
    bySeason: seasons.map(season => ({
      season,
      ...score(data.forecasts.filter(row => row.season === season))
    }))
  });
}

const baseline = candidates[0];
candidates.forEach(candidate => {
  candidate.overall.brierImprovementPct = 100 * (1 - candidate.overall.brier / baseline.overall.brier);
  candidate.overall.logLossImprovementPct = 100 * (1 - candidate.overall.logLoss / baseline.overall.logLoss);
  candidate.bySeason.forEach((season, index) => {
    const comparison = baseline.bySeason[index];
    season.brierImprovementPct = 100 * (1 - season.brier / comparison.brier);
    season.logLossImprovementPct = 100 * (1 - season.logLoss / comparison.logLoss);
  });
});

const output = {
  generatedAt: new Date().toISOString(),
  status: 'experimental_not_promoted',
  method: 'One-week roster projections affect only their target game week; later simulated weeks use the tuned PF distribution.',
  baseline: baseline.label,
  candidates,
  screenedRefinements: [
    'Separating the posterior-estimation variance floor from future-game variance did not beat the existing 40-point setting.',
    'Capping roster-versus-league projection differences at 10, 15, or 20 points did not improve season-held-out stability.',
    'Stopping roster adjustments after completed Week 12 improved this sample, but was rejected as a production rule because the cutoff was identified post-hoc and Week 13 score forecasts still improved.'
  ],
  decisionRule: 'Promote only after season-held-out Brier and log loss improve stably without relying on a post-hoc week cutoff.'
};
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`Saved ${path.relative(root, outputPath)}\n`);
