import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = process.env.CALIBRATION_INPUT
  ? path.resolve(root, process.env.CALIBRATION_INPUT)
  : path.join(root, 'public/data/historical_backtest.json');
const outputPath = process.env.CALIBRATION_OUTPUT
  ? path.resolve(root, process.env.CALIBRATION_OUTPUT)
  : path.join(root, 'public/data/historical_calibration.json');
const backtest = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const outcomes = ['playoff', 'bye', 'divisionWinner', 'last'];
const clamp = value => Math.min(0.999, Math.max(0.001, value));
const logistic = value => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
const logit = value => Math.log(clamp(value) / (1 - clamp(value)));

function fitPlatt(rows, regularization = 1) {
  let intercept = 0;
  let slope = 1;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    let g0 = regularization * intercept;
    let g1 = regularization * (slope - 1);
    let h00 = regularization;
    let h01 = 0;
    let h11 = regularization;
    rows.forEach(row => {
      const x = logit(row.probability);
      const prediction = logistic(intercept + slope * x);
      const residual = prediction - row.actual;
      const weight = Math.max(1e-8, prediction * (1 - prediction));
      g0 += residual;
      g1 += residual * x;
      h00 += weight;
      h01 += weight * x;
      h11 += weight * x * x;
    });
    const determinant = h00 * h11 - h01 * h01;
    if (Math.abs(determinant) < 1e-12) break;
    const step0 = (h11 * g0 - h01 * g1) / determinant;
    const step1 = (-h01 * g0 + h00 * g1) / determinant;
    intercept -= step0;
    slope -= step1;
    if (Math.max(Math.abs(step0), Math.abs(step1)) < 1e-8) break;
  }
  return { intercept, slope };
}

const score = rows => {
  const brier = rows.reduce((sum, row) => sum + (row.probability - row.actual) ** 2, 0) / rows.length;
  const logLoss = rows.reduce((sum, row) => {
    const probability = clamp(row.probability);
    return sum - (row.actual ? Math.log(probability) : Math.log(1 - probability));
  }, 0) / rows.length;
  return { brier, logLoss };
};

const results = {};
for (const outcome of outcomes) {
  const rows = backtest.forecasts.map(row => ({
    season: row.season,
    probability: row[outcome] / 100,
    actual: Number(row.actual[outcome])
  }));
  const seasons = [...new Set(rows.map(row => row.season))];
  const heldOut = [];
  const folds = [];
  seasons.forEach(season => {
    const training = rows.filter(row => row.season !== season);
    const testing = rows.filter(row => row.season === season);
    const coefficients = fitPlatt(training);
    const calibrated = testing.map(row => ({
      ...row,
      probability: logistic(coefficients.intercept + coefficients.slope * logit(row.probability))
    }));
    heldOut.push(...calibrated);
    folds.push({ season, coefficients, raw: score(testing), calibrated: score(calibrated) });
  });
  const raw = score(rows);
  const calibrated = score(heldOut);
  results[outcome] = {
    method: 'regularized_platt_logistic',
    finalCoefficients: fitPlatt(rows),
    outOfSeason: {
      raw,
      calibrated,
      brierImprovementPct: (1 - calibrated.brier / raw.brier) * 100,
      logLossImprovementPct: (1 - calibrated.logLoss / raw.logLoss) * 100
    },
    folds
  };
}

const output = {
  generatedAt: new Date().toISOString(),
  sourceBacktestGeneratedAt: backtest.generatedAt,
  method: 'Leave-one-season-out Platt calibration; each held-out season is adjusted only with coefficients fitted on the other six seasons.',
  recommendation: Object.values(results).every(result => result.outOfSeason.brierImprovementPct > 0 && result.outOfSeason.logLossImprovementPct > 0)
    ? 'eligible_for_live_integration'
    : 'do_not_apply_globally',
  results
};
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ recommendation: output.recommendation, results: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.outOfSeason])) }, null, 2)}\n`);
