#!/usr/bin/env python3
"""Season-held-out next-score evaluation of research-only player usage features."""

from __future__ import annotations

import json
import math
import os
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
USAGE = ROOT / "data" / "historical_player_usage_features.json"
PROJECTIONS = ROOT / "data" / "historical_roster_projection_features.json"
HISTORY = ROOT / "public" / "data" / "excel_history.json"
OUTPUT = Path(os.environ.get(
    "PLAYER_USAGE_EVALUATION_OUTPUT",
    ROOT / "data" / "historical_player_usage_evaluation.json",
))
RIDGE = 10.0


def mean(values):
    return sum(values) / len(values)


def standard_deviation(values):
    center = mean(values)
    return math.sqrt(mean([(value - center) ** 2 for value in values]))


def solve(matrix, vector):
    size = len(vector)
    augmented = [list(row) + [vector[index]] for index, row in enumerate(matrix)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        if abs(divisor) < 1e-12:
            return [0.0] * size
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [
                value - factor * augmented[column][index]
                for index, value in enumerate(augmented[row])
            ]
    return [row[-1] for row in augmented]


def posterior_mean(team_scores, league_scores):
    league_mean = mean(league_scores)
    raw_mean = mean(team_scores)
    observed = standard_deviation(team_scores) if len(team_scores) >= 2 else max(math.sqrt(raw_mean) * 1.5, 16)
    prior_variance = 15 ** 2
    observation_variance = max(observed ** 2, 40 ** 2)
    variance = 1 / (1 / prior_variance + len(team_scores) / observation_variance)
    return variance * (league_mean / prior_variance + len(team_scores) * raw_mean / observation_variance)


def fit(rows, features):
    centers = {feature: mean([row[feature] for row in rows]) for feature in features}
    scales = {
        feature: standard_deviation([row[feature] for row in rows]) or 1
        for feature in features
    }
    design = [
        [1] + [(row[feature] - centers[feature]) / scales[feature] for feature in features]
        for row in rows
    ]
    response = [row["actual"] - row["baseline"] for row in rows]
    width = len(features) + 1
    matrix = [[0.0] * width for _ in range(width)]
    vector = [0.0] * width
    for values, target in zip(design, response):
        for left in range(width):
            vector[left] += values[left] * target
            for right in range(width):
                matrix[left][right] += values[left] * values[right]
    for index in range(1, width):
        matrix[index][index] += RIDGE
    return solve(matrix, vector), centers, scales


def evaluate(rows, features):
    seasons = sorted({row["season"] for row in rows})
    squared_baseline = squared_candidate = absolute_baseline = absolute_candidate = 0.0
    by_season = []
    for season in seasons:
        training = [row for row in rows if row["season"] != season]
        testing = [row for row in rows if row["season"] == season]
        coefficients, centers, scales = fit(training, features)
        base_errors, candidate_errors = [], []
        for row in testing:
            adjustment = coefficients[0] + sum(
                coefficients[index + 1] * (row[feature] - centers[feature]) / scales[feature]
                for index, feature in enumerate(features)
            )
            base_errors.append(row["baseline"] - row["actual"])
            candidate_errors.append(row["baseline"] + adjustment - row["actual"])
        squared_baseline += sum(error ** 2 for error in base_errors)
        squared_candidate += sum(error ** 2 for error in candidate_errors)
        absolute_baseline += sum(abs(error) for error in base_errors)
        absolute_candidate += sum(abs(error) for error in candidate_errors)
        base_rmse = math.sqrt(mean([error ** 2 for error in base_errors]))
        candidate_rmse = math.sqrt(mean([error ** 2 for error in candidate_errors]))
        by_season.append({
            "season": season,
            "forecasts": len(testing),
            "baselineRmse": round(base_rmse, 4),
            "candidateRmse": round(candidate_rmse, 4),
            "rmseImprovementPct": round(100 * (1 - candidate_rmse / base_rmse), 3),
        })
    forecasts = len(rows)
    baseline_rmse = math.sqrt(squared_baseline / forecasts)
    candidate_rmse = math.sqrt(squared_candidate / forecasts)
    return {
        "features": features,
        "forecasts": forecasts,
        "baselineRmse": round(baseline_rmse, 4),
        "candidateRmse": round(candidate_rmse, 4),
        "rmseImprovementPct": round(100 * (1 - candidate_rmse / baseline_rmse), 3),
        "baselineMae": round(absolute_baseline / forecasts, 4),
        "candidateMae": round(absolute_candidate / forecasts, 4),
        "heldOutSeasonWins": sum(row["candidateRmse"] < row["baselineRmse"] for row in by_season),
        "bySeason": by_season,
    }


def main():
    usage = json.loads(USAGE.read_text())
    projections = json.loads(PROJECTIONS.read_text())
    history = json.loads(HISTORY.read_text())
    scores = defaultdict(dict)
    for game in history["MatchLog_PlayoffIncluded"]:
        if game.get("game_type") != "regular":
            continue
        key = (int(game["season"]), int(game["week"]))
        scores[key][game["awayTeamName"]] = float(game["awayScore"])
        scores[key][game["homeTeamName"]] = float(game["homeScore"])

    projection_index = {}
    for season in projections["seasons"]:
        for checkpoint in season["checkpoints"]:
            complete = [team for team in checkpoint["teams"] if team["lineupComplete"]]
            league_mean = mean([team["optimalProjectedPoints"] for team in complete]) if complete else 0
            for team in complete:
                projection_index[(season["season"], checkpoint["completedWeek"], team["team"])] = (
                    team["optimalProjectedPoints"] - league_mean
                )

    raw_rows = []
    feature_names = [
        "lineupSnapShare", "lineupOpportunities", "lineupTargetShare",
        "lineupRedZoneOpportunities", "lineupDepthScore",
        "trailingLineupSnapShare", "trailingLineupOpportunities",
        "trailingLineupRedZoneOpportunities", "rosterOpportunityConcentration",
        "targetPerOffensiveSnap",
    ]
    for season in usage["seasons"]:
        season_id = season["season"]
        for checkpoint in season["checkpoints"]:
            completed_week = checkpoint["completedWeek"]
            completed = [
                value
                for week in range(1, completed_week + 1)
                for value in scores[(season_id, week)].values()
            ]
            if not completed:
                continue
            checkpoint_means = {
                feature: mean([team[feature] for team in checkpoint["teams"]])
                for feature in feature_names
            }
            for team in checkpoint["teams"]:
                actual = scores[(season_id, checkpoint["forecastWeek"])].get(team["team"])
                team_scores = [
                    scores[(season_id, week)][team["team"]]
                    for week in range(1, completed_week + 1)
                    if team["team"] in scores[(season_id, week)]
                ]
                if actual is None or not team_scores:
                    continue
                row = {
                    "season": season_id,
                    "completedWeek": completed_week,
                    "team": team["team"],
                    "actual": actual,
                    "baseline": posterior_mean(team_scores, completed),
                    "projection": projection_index.get((season_id, completed_week, team["team"]), 0),
                }
                for feature in feature_names:
                    row[feature] = team[feature] - checkpoint_means[feature]
                raw_rows.append(row)

    specifications = [
        [],
        ["projection"],
        *[[feature] for feature in feature_names],
        ["lineupSnapShare", "lineupOpportunities", "lineupRedZoneOpportunities", "lineupDepthScore"],
        ["trailingLineupSnapShare", "trailingLineupOpportunities", "trailingLineupRedZoneOpportunities"],
        ["projection", "lineupSnapShare", "lineupOpportunities", "lineupRedZoneOpportunities", "lineupDepthScore"],
        ["projection", "trailingLineupSnapShare", "trailingLineupOpportunities", "trailingLineupRedZoneOpportunities"],
    ]
    evaluations = [evaluate(raw_rows, features) for features in specifications]
    intercept_only = evaluations[0]
    for evaluation in evaluations:
        evaluation["incrementalVsInterceptOnlyRmsePct"] = round(
            100 * (1 - evaluation["candidateRmse"] / intercept_only["candidateRmse"]), 3
        )
    best_usage_only = min(
        (row for row in evaluations if row["features"] and "projection" not in row["features"]),
        key=lambda row: row["candidateRmse"],
    )
    best_with_projection = min((row for row in evaluations if "projection" in row["features"]), key=lambda row: row["candidateRmse"])
    payload = {
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "status": "research_only_not_used_by_live_simulator",
        "method": "Ridge residual correction to the tuned PF posterior, evaluated with entire seasons held out.",
        "ridgePenalty": RIDGE,
        "sample": {"forecasts": len(raw_rows), "seasons": sorted({row["season"] for row in raw_rows})},
        "evaluations": evaluations,
        "interceptOnly": intercept_only,
        "bestUsageOnly": best_usage_only,
        "bestWithProjection": best_with_projection,
        "decisionRule": "Do not promote a usage feature unless it improves RMSE across most held-out seasons and adds value beyond archived optimal-lineup projections.",
    }
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Saved {OUTPUT.relative_to(ROOT)}")
    print(
        f"Best usage-only: {best_usage_only['features']} {best_usage_only['rmseImprovementPct']}%; "
        f"best with projection: {best_with_projection['features']} {best_with_projection['rmseImprovementPct']}%."
    )


if __name__ == "__main__":
    main()
