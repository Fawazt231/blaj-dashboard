import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.resolve(root, process.env.ROSTER_COMPARISON_BASELINE || 'data/historical_roster_projection_features.json');
const challengerPath = path.resolve(root, process.env.ROSTER_COMPARISON_CHALLENGER || 'data/historical_point_in_time_projection_features.json');
const outputPath = path.resolve(root, process.env.ROSTER_COMPARISON_OUTPUT || 'data/point_in_time_roster_comparison.json');
const history = JSON.parse(await fs.readFile(path.join(root, 'public/data/excel_history.json'), 'utf8'));
const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
const challenger = JSON.parse(await fs.readFile(challengerPath, 'utf8'));

const games = history.MatchLog_PlayoffIncluded.filter(game => game.game_type === 'regular');
const actualScores = new Map();
const scoresByWeek = new Map();
games.forEach(game => {
  [[game.awayTeamName, Number(game.awayScore)], [game.homeTeamName, Number(game.homeScore)]]
    .forEach(([team, score]) => {
      actualScores.set(`${game.season}|${game.week}|${team}`, score);
      const key = `${game.season}|${game.week}`;
      if (!scoresByWeek.has(key)) scoresByWeek.set(key, []);
      scoresByWeek.get(key).push([team, score]);
    });
});

function featureIndex(data) {
  return new Map(data.seasons.flatMap(season => season.checkpoints.flatMap(checkpoint => {
    const complete = checkpoint.teams.filter(team => (
      team.lineupComplete && Number.isFinite(team.optimalProjectedPoints)
    ));
    const projectedLeagueMean = complete.reduce(
      (sum, team) => sum + team.optimalProjectedPoints,
      0
    ) / complete.length;
    return complete.map(team => [
      `${season.season}|${checkpoint.completedWeek}|${team.team}`,
      { ...team, season: season.season, completedWeek: checkpoint.completedWeek,
        projectionWeek: checkpoint.projectionWeek, projectedLeagueMean }
    ]);
  })));
}

function pfPosteriorMean(teamScores, leagueMean) {
  const rawMean = teamScores.reduce((sum, score) => sum + score, 0) / teamScores.length;
  const observedStd = teamScores.length >= 2
    ? Math.sqrt(teamScores.reduce((sum, score) => sum + (score - rawMean) ** 2, 0) / (teamScores.length - 1))
    : Math.max(Math.sqrt(Math.max(rawMean, 1)) * 1.5, 16);
  const priorVariance = 15 ** 2;
  const observationVariance = Math.max(observedStd ** 2, 40 ** 2);
  const posteriorVariance = 1 / (1 / priorVariance + teamScores.length / observationVariance);
  return posteriorVariance * (leagueMean / priorVariance + teamScores.length * rawMean / observationVariance);
}

const baselineIndex = featureIndex(baseline);
const challengerIndex = featureIndex(challenger);
const rows = [];
baselineIndex.forEach((baselineTeam, key) => {
  const challengerTeam = challengerIndex.get(key);
  if (!challengerTeam) return;
  const completed = [];
  for (let week = 1; week <= baselineTeam.completedWeek; week += 1) {
    completed.push(...(scoresByWeek.get(`${baselineTeam.season}|${week}`) || []));
  }
  const actual = actualScores.get(
    `${baselineTeam.season}|${baselineTeam.projectionWeek}|${baselineTeam.team}`
  );
  if (!completed.length || !Number.isFinite(actual)) return;
  const leagueMean = completed.reduce((sum, [, score]) => sum + score, 0) / completed.length;
  const teamScores = completed.filter(([team]) => team === baselineTeam.team).map(([, score]) => score);
  const pfMean = pfPosteriorMean(teamScores, leagueMean);
  rows.push({
    season: baselineTeam.season,
    actual,
    pfMean,
    baselineMean: leagueMean + baselineTeam.optimalProjectedPoints - baselineTeam.projectedLeagueMean,
    challengerMean: leagueMean + challengerTeam.optimalProjectedPoints - challengerTeam.projectedLeagueMean
  });
});

function metrics(selectedRows, key, blend = 0.5) {
  const errors = selectedRows.map(row => (
    (1 - blend) * row.pfMean + blend * row[key] - row.actual
  ));
  return {
    forecasts: errors.length,
    rmse: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length),
    mae: errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length
  };
}

const seasons = [...new Set(rows.map(row => row.season))].sort();
const baselineOverall = metrics(rows, 'baselineMean');
const challengerOverall = metrics(rows, 'challengerMean');
const output = {
  generatedAt: new Date().toISOString(),
  status: 'research_only_not_used_by_live_simulator',
  method: 'Paired comparison on checkpoints where both roster inputs produce a complete projected lineup; both use a 50% PF and 50% lineup-projection blend.',
  baselineSource: path.relative(root, baselinePath),
  challengerSource: path.relative(root, challengerPath),
  pairedForecasts: rows.length,
  baseline: baselineOverall,
  challenger: challengerOverall,
  challengerRmseImprovementPct: 100 * (1 - challengerOverall.rmse / baselineOverall.rmse),
  changedForecasts: rows.filter(row => Math.abs(row.baselineMean - row.challengerMean) > 1e-9).length,
  meanAbsoluteProjectionChange: rows.reduce(
    (sum, row) => sum + Math.abs(row.baselineMean - row.challengerMean),
    0
  ) / rows.length,
  bySeason: seasons.map(season => {
    const selected = rows.filter(row => row.season === season);
    const baselineMetrics = metrics(selected, 'baselineMean');
    const challengerMetrics = metrics(selected, 'challengerMean');
    return {
      season,
      forecasts: selected.length,
      baselineRmse: baselineMetrics.rmse,
      challengerRmse: challengerMetrics.rmse,
      challengerRmseImprovementPct: 100 * (1 - challengerMetrics.rmse / baselineMetrics.rmse)
    };
  }),
  decision: 'Do not promote point-in-time roster reconstruction unless its paired improvement is material and remains positive downstream in playoff-probability scoring.'
};

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`Saved ${path.relative(root, outputPath)}\n`);
