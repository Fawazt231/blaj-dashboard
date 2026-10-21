import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const history = JSON.parse(await fs.readFile(path.join(root, 'public/data/excel_history.json'), 'utf8'));
const features = JSON.parse(
  await fs.readFile(path.join(root, 'data/historical_roster_projection_features.json'), 'utf8')
);
const outputPath = process.env.ROSTER_EVALUATION_OUTPUT
  ? path.resolve(root, process.env.ROSTER_EVALUATION_OUTPUT)
  : path.join(root, 'data/roster_model_evaluation.json');
const blends = [0, 0.1, 0.2, 0.3, 0.4, 0.5];

const round = (value, digits = 4) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const games = history.MatchLog_PlayoffIncluded.filter(game => game.game_type === 'regular');
const actualScore = new Map();
const scoresByWeek = new Map();
games.forEach(game => {
  const rows = [
    [game.awayTeamName, Number(game.awayScore)],
    [game.homeTeamName, Number(game.homeScore)]
  ];
  rows.forEach(([team, score]) => actualScore.set(`${game.season}|${game.week}|${team}`, score));
  const key = `${game.season}|${game.week}`;
  if (!scoresByWeek.has(key)) scoresByWeek.set(key, []);
  scoresByWeek.get(key).push(...rows);
});

function pfPosteriorMean(teamScores, leagueMean) {
  const rawMean = teamScores.reduce((sum, score) => sum + score, 0) / teamScores.length;
  const observedStd = teamScores.length >= 2
    ? Math.sqrt(teamScores.reduce((sum, score) => sum + (score - rawMean) ** 2, 0) / (teamScores.length - 1))
    : Math.max(Math.sqrt(Math.max(rawMean, 1)) * 1.5, 16);
  const priorVariance = 15 ** 2;
  const observationVariance = Math.max(observedStd ** 2, 40 ** 2);
  const posteriorVariance = 1 / (1 / priorVariance + teamScores.length / observationVariance);
  return posteriorVariance * (
    leagueMean / priorVariance + teamScores.length * rawMean / observationVariance
  );
}

const rows = [];
features.seasons.forEach(season => {
  season.checkpoints.forEach(checkpoint => {
    const completed = [];
    for (let week = 1; week <= checkpoint.completedWeek; week += 1) {
      completed.push(...(scoresByWeek.get(`${season.season}|${week}`) || []));
    }
    const leagueMean = completed.reduce((sum, [, score]) => sum + score, 0) / completed.length;
    const completeTeams = checkpoint.teams.filter(team => team.lineupComplete);
    const projectedLeagueMean = completeTeams.reduce(
      (sum, team) => sum + team.optimalProjectedPoints,
      0
    ) / completeTeams.length;
    completeTeams.forEach(team => {
      const teamScores = completed.filter(([name]) => name === team.team).map(([, score]) => score);
      const actual = actualScore.get(`${season.season}|${checkpoint.projectionWeek}|${team.team}`);
      if (!teamScores.length || !Number.isFinite(actual)) return;
      rows.push({
        season: season.season,
        completedWeek: checkpoint.completedWeek,
        team: team.team,
        actual,
        pfMean: pfPosteriorMean(teamScores, leagueMean),
        rosterMean: leagueMean + team.optimalProjectedPoints - projectedLeagueMean
      });
    });
  });
});

function metrics(inputRows, blend) {
  const errors = inputRows.map(row => (
    (1 - blend) * row.pfMean + blend * row.rosterMean - row.actual
  ));
  return {
    forecasts: errors.length,
    rmse: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length),
    mae: errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length,
    bias: errors.reduce((sum, error) => sum + error, 0) / errors.length
  };
}

const seasons = [...new Set(rows.map(row => row.season))].sort();
const fixedBlendResults = blends.map(blend => ({
  blend,
  ...Object.fromEntries(Object.entries(metrics(rows, blend)).map(([key, value]) => [key, round(value)])),
  bySeason: seasons.map(season => ({
    season,
    ...Object.fromEntries(Object.entries(metrics(rows.filter(row => row.season === season), blend))
      .map(([key, value]) => [key, round(value)]))
  }))
}));

const leaveOneSeasonOut = seasons.map(heldOutSeason => {
  const trainingRows = rows.filter(row => row.season !== heldOutSeason);
  const heldOutRows = rows.filter(row => row.season === heldOutSeason);
  const selectedBlend = [...blends].sort((left, right) => (
    metrics(trainingRows, left).rmse - metrics(trainingRows, right).rmse
  ))[0];
  const baseline = metrics(heldOutRows, 0);
  const challenger = metrics(heldOutRows, selectedBlend);
  return {
    heldOutSeason,
    selectedBlend,
    baselineRmse: round(baseline.rmse),
    challengerRmse: round(challenger.rmse),
    rmseImprovementPct: round((baseline.rmse - challenger.rmse) / baseline.rmse * 100, 3),
    baselineMae: round(baseline.mae),
    challengerMae: round(challenger.mae)
  };
});

const bestFixed = [...fixedBlendResults].sort((left, right) => left.rmse - right.rmse)[0];
const output = {
  generatedAt: new Date().toISOString(),
  status: 'challenger_not_promoted',
  method: 'Predict the next weekly team score from the tuned PF posterior and the optimal projected lineup, using only the completed-week roster.',
  sample: {
    forecasts: rows.length,
    seasons,
    completeProjectedLineups: rows.length,
    totalFeatureCheckpoints: features.seasons.reduce((sum, season) => sum + season.audit.teamCheckpoints, 0)
  },
  fixedBlendResults,
  bestFixedBlend: bestFixed.blend,
  bestFixedRmse: bestFixed.rmse,
  pfOnlyRmse: fixedBlendResults.find(result => result.blend === 0).rmse,
  leaveOneSeasonOut,
  heldOutSeasonWins: leaveOneSeasonOut.filter(result => result.challengerRmse < result.baselineRmse).length,
  decision: 'Roster projections contain predictive signal, but stay experimental until the season-out playoff-probability test shows a material, stable gain without worse calibration.'
};

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${output.sample.forecasts} forecasts; best fixed blend ${output.bestFixedBlend}; ` +
  `${output.heldOutSeasonWins}/${seasons.length} held-out seasons improved.\n`);
process.stdout.write(`Saved ${path.relative(root, outputPath)}\n`);
