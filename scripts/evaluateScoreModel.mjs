import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSimulationTeamProfiles } from '../src/playoffSimulatorEngine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const history = JSON.parse(await fs.readFile(path.join(root, 'public/data/excel_history.json'), 'utf8'));
const priorStd = Number(process.env.SCORE_PRIOR_STD || 15);
const minSigma = Number(process.env.SCORE_MIN_SIGMA || 50);
const weeklySigma = Number(process.env.SCORE_WEEKLY_SIGMA || 17);
const volatilityPriorGames = Number(process.env.SCORE_VOLATILITY_PRIOR_GAMES || 16);
const normalPdf = value => Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
const erf = value => {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const approximation = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * approximation;
};
const normalCdf = value => 0.5 * (1 + erf(value / Math.sqrt(2)));
const regular = history.MatchLog_PlayoffIncluded.filter(game => (
  String(game.game_type || 'regular').toLowerCase() === 'regular'
  && Number(game.season) >= 2019
  && Number(game.season) <= 2025
));

const predictions = [];
for (const season of [...new Set(regular.map(game => Number(game.season)))].sort()) {
  const games = regular.filter(game => Number(game.season) === season);
  const finalWeek = Math.max(...games.map(game => Number(game.week)));
  const names = [...new Set(games.flatMap(game => [game.awayTeamName, game.homeTeamName]))];
  for (let completedWeek = 1; completedWeek < finalWeek; completedWeek += 1) {
    const played = games.filter(game => Number(game.week) <= completedWeek);
    const teams = names.map(name => {
      const teamGames = played.filter(game => [game.awayTeamName, game.homeTeamName].includes(name));
      const weeklyScores = teamGames.map(game => game.awayTeamName === name ? Number(game.awayScore) : Number(game.homeScore));
      return {
        name,
        wins: teamGames.filter(game => game.winner === name).length,
        losses: teamGames.filter(game => game.loser === name).length,
        fpts: weeklyScores.reduce((sum, score) => sum + score, 0),
        weeklyScores
      };
    });
    const profiles = new Map(buildSimulationTeamProfiles({
      teams,
      model: 'Bayesian',
      priorStd,
      minSigma,
      scoreModel: 'hierarchical',
      weeklySigma,
      volatilityPriorGames
    }).map(profile => [profile.name, profile]));
    games.filter(game => Number(game.week) === completedWeek + 1).forEach(game => {
      [[game.awayTeamName, Number(game.awayScore)], [game.homeTeamName, Number(game.homeScore)]].forEach(([team, actual]) => {
        const profile = profiles.get(team);
        if (!profile || !Number.isFinite(actual)) return;
        predictions.push({
          actual,
          mean: profile.mean,
          sigma: Math.sqrt(profile.std ** 2 + profile.strengthStd ** 2)
        });
      });
    });
  }
}

const coverage = multiplier => predictions.filter(item => Math.abs(item.actual - item.mean) <= multiplier * item.sigma).length / predictions.length;
const tail = (threshold, direction) => predictions.reduce((sum, item) => {
  const below = normalCdf((threshold - item.mean) / item.sigma);
  return sum + (direction === 'below' ? below : 1 - below);
}, 0) / predictions.length;
const observedTail = (threshold, direction) => predictions.filter(item => (
  direction === 'below' ? item.actual < threshold : item.actual > threshold
)).length / predictions.length;
const summary = {
  parameters: { priorStd, minSigma, weeklySigma, volatilityPriorGames },
  forecasts: predictions.length,
  rmse: Math.sqrt(predictions.reduce((sum, item) => sum + (item.actual - item.mean) ** 2, 0) / predictions.length),
  mae: predictions.reduce((sum, item) => sum + Math.abs(item.actual - item.mean), 0) / predictions.length,
  negativeLogLikelihood: predictions.reduce((sum, item) => {
    const z = (item.actual - item.mean) / item.sigma;
    return sum + Math.log(item.sigma * Math.sqrt(2 * Math.PI)) + 0.5 * z * z;
  }, 0) / predictions.length,
  crps: predictions.reduce((sum, item) => {
    const z = (item.actual - item.mean) / item.sigma;
    return sum + item.sigma * (z * (2 * normalCdf(z) - 1) + 2 * normalPdf(z) - 1 / Math.sqrt(Math.PI));
  }, 0) / predictions.length,
  coverage: { p50: coverage(0.67449), p80: coverage(1.28155), p90: coverage(1.64485), p95: coverage(1.95996) },
  tails: Object.fromEntries([
    [0, 'below'], [50, 'below'], [150, 'above'], [169.2, 'above'], [200, 'above']
  ].map(([threshold, direction]) => [`${direction}${threshold}`, {
    predicted: tail(threshold, direction),
    observed: observedTail(threshold, direction)
  }]))
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
