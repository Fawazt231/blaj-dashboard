#!/usr/bin/env python3
"""Build leakage-safe historical fantasy-roster usage features for research.

The feature at completed Week N only uses NFL usage from Weeks <= N and the
Sleeper fantasy roster saved in the Week N matchup snapshot. Raw nflverse files
are downloaded into a temporary/cache directory and are not committed.
"""

from __future__ import annotations

import csv
import gzip
import json
import math
import os
import tempfile
import urllib.request
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOTS = ROOT / "data" / "historical_roster_snapshots.json"
OUTPUT = Path(os.environ.get(
    "PLAYER_USAGE_OUTPUT",
    ROOT / "data" / "historical_player_usage_features.json",
))
CACHE = Path(os.environ.get("NFLVERSE_CACHE_DIR", tempfile.gettempdir())) / "blaj-nflverse-usage"
SEASONS = range(2019, 2026)
SKILL_POSITIONS = {"QB", "RB", "WR", "TE"}
BASE = "https://github.com/nflverse/nflverse-data/releases/download"


def number(value, default=0.0):
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def download(url: str, filename: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / filename
    if not target.exists() or target.stat().st_size == 0:
        print(f"Downloading {filename}")
        request = urllib.request.Request(url, headers={"User-Agent": "blaj-dashboard-research/1.0"})
        with urllib.request.urlopen(request) as response, target.open("wb") as stream:
            while chunk := response.read(1024 * 1024):
                stream.write(chunk)
    return target


def csv_rows(path: Path):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", newline="", encoding="utf-8") as stream:
        yield from csv.DictReader(stream)


def optimize_skill_lineup(players: list[dict], field: str) -> float:
    """Maximize one QB, two RB, two WR, one TE, and one RB/WR/TE flex."""
    remaining = list(players)
    total = 0.0
    for position, count in (("QB", 1), ("RB", 2), ("WR", 2), ("TE", 1)):
        eligible = sorted(
            (player for player in remaining if player["position"] == position),
            key=lambda player: player[field],
            reverse=True,
        )[:count]
        total += sum(player[field] for player in eligible)
        chosen = {player["sleeperId"] for player in eligible}
        remaining = [player for player in remaining if player["sleeperId"] not in chosen]
    flex = max(
        (player[field] for player in remaining if player["position"] in {"RB", "WR", "TE"}),
        default=0.0,
    )
    return total + flex


def load_season_sources(season: int):
    urls = {
        "rosters": f"{BASE}/weekly_rosters/roster_weekly_{season}.csv",
        "stats": f"{BASE}/stats_player/stats_player_week_{season}.csv",
        "snaps": f"{BASE}/snap_counts/snap_counts_{season}.csv",
        "depth": f"{BASE}/depth_charts/depth_charts_{season}.csv",
        "pbp": f"{BASE}/pbp/play_by_play_{season}.csv.gz",
    }
    paths = {
        key: download(url, f"{key}_{season}.csv" + (".gz" if key == "pbp" else ""))
        for key, url in urls.items()
    }

    identities = {}
    identity_by_week = {}
    for row in csv_rows(paths["rosters"]):
        if row.get("game_type") != "REG" or row.get("position") not in SKILL_POSITIONS:
            continue
        sleeper_id = str(row.get("sleeper_id") or "").strip()
        if not sleeper_id:
            continue
        week = int(number(row.get("week")))
        identity = {
            "sleeperId": sleeper_id,
            "gsisId": str(row.get("gsis_id") or "").strip(),
            "pfrId": str(row.get("pfr_id") or "").strip(),
            "position": row.get("position"),
        }
        identity_by_week[(week, sleeper_id)] = identity
        identities[sleeper_id] = identity

    stats = defaultdict(lambda: {"targets": 0.0, "carries": 0.0, "targetShare": 0.0})
    for row in csv_rows(paths["stats"]):
        if row.get("season_type") != "REG":
            continue
        week, gsis_id = int(number(row.get("week"))), str(row.get("player_id") or "")
        stats[(week, gsis_id)] = {
            "targets": number(row.get("targets")),
            "carries": number(row.get("carries")),
            "targetShare": number(row.get("target_share")),
        }

    snaps = defaultdict(lambda: {"snapShare": 0.0, "offenseSnaps": 0.0})
    for row in csv_rows(paths["snaps"]):
        if row.get("game_type") != "REG":
            continue
        snaps[(int(number(row.get("week"))), str(row.get("pfr_player_id") or ""))] = {
            "snapShare": number(row.get("offense_pct")),
            "offenseSnaps": number(row.get("offense_snaps")),
        }

    depth = defaultdict(int)
    for row in csv_rows(paths["depth"]):
        if row.get("game_type") != "REG":
            continue
        depth[(int(number(row.get("week"))), str(row.get("gsis_id") or ""))] = int(
            number(row.get("depth_team"), 0)
        )

    red_zone = defaultdict(lambda: {"rzCarries": 0.0, "rzTargets": 0.0})
    for row in csv_rows(paths["pbp"]):
        if row.get("season_type") != "REG" or number(row.get("yardline_100"), 101) > 20:
            continue
        week = int(number(row.get("week")))
        if number(row.get("rush_attempt")) == 1:
            player_id = str(row.get("rusher_player_id") or "")
            if player_id:
                red_zone[(week, player_id)]["rzCarries"] += 1
        if number(row.get("pass_attempt")) == 1:
            player_id = str(row.get("receiver_player_id") or "")
            if player_id:
                red_zone[(week, player_id)]["rzTargets"] += 1

    return urls, identities, identity_by_week, stats, snaps, depth, red_zone


def main():
    snapshot_data = json.loads(SNAPSHOTS.read_text())
    snapshot_seasons = {int(row["season"]): row for row in snapshot_data["seasons"]}
    output_seasons = []
    source_urls = {}
    overall = defaultdict(int)

    for season in SEASONS:
        urls, identities, identity_by_week, stats, snaps, depth, red_zone = load_season_sources(season)
        source_urls[str(season)] = urls
        snapshot = snapshot_seasons[season]
        weeks = {int(row["week"]): row for row in snapshot["weeks"]}
        checkpoints = []
        audit = defaultdict(int)
        for key in (
            "fantasyRosterPlayers", "mappedSkillPlayers", "playersWithSnapRow",
            "playersWithOpportunity", "playersWithDepthRole", "teamCheckpoints",
        ):
            audit[key] = 0

        for completed_week in sorted(weeks):
            if completed_week >= int(snapshot["playoffStartWeek"]) - 1:
                continue
            teams = []
            for team in weeks[completed_week]["teams"]:
                players = []
                audit["fantasyRosterPlayers"] += len(team["players"])
                for raw_id in team["players"]:
                    sleeper_id = str(raw_id)
                    identity = identity_by_week.get((completed_week, sleeper_id), identities.get(sleeper_id))
                    if not identity or identity["position"] not in SKILL_POSITIONS:
                        continue
                    audit["mappedSkillPlayers"] += 1
                    weekly = []
                    for week in range(max(1, completed_week - 2), completed_week + 1):
                        stat = stats[(week, identity["gsisId"])]
                        snap = snaps[(week, identity["pfrId"])]
                        rz = red_zone[(week, identity["gsisId"])]
                        depth_team = depth[(week, identity["gsisId"])]
                        weekly.append({**stat, **snap, **rz, "depthTeam": depth_team})
                    last = weekly[-1]
                    if last["offenseSnaps"] > 0:
                        audit["playersWithSnapRow"] += 1
                    if last["targets"] + last["carries"] > 0:
                        audit["playersWithOpportunity"] += 1
                    if last["depthTeam"] > 0:
                        audit["playersWithDepthRole"] += 1
                    players.append({
                        **identity,
                        "snapShare": last["snapShare"],
                        "offenseSnaps": last["offenseSnaps"],
                        "opportunities": last["targets"] + last["carries"],
                        "targets": last["targets"],
                        "carries": last["carries"],
                        "targetShare": last["targetShare"],
                        "redZoneOpportunities": last["rzCarries"] + last["rzTargets"],
                        "depthScore": 1 / last["depthTeam"] if last["depthTeam"] > 0 else 0,
                        "trailingSnapShare": sum(row["snapShare"] for row in weekly) / len(weekly),
                        "trailingOpportunities": sum(row["targets"] + row["carries"] for row in weekly) / len(weekly),
                        "trailingRedZoneOpportunities": sum(row["rzCarries"] + row["rzTargets"] for row in weekly) / len(weekly),
                    })

                total_snaps = sum(player["offenseSnaps"] if "offenseSnaps" in player else 0 for player in players)
                total_targets = sum(player["targets"] for player in players)
                opportunity_values = sorted((player["opportunities"] for player in players), reverse=True)
                teams.append({
                    "rosterId": team["rosterId"],
                    "team": team["team"],
                    "mappedSkillPlayers": len(players),
                    "lineupSnapShare": round(optimize_skill_lineup(players, "snapShare"), 4),
                    "lineupOpportunities": round(optimize_skill_lineup(players, "opportunities"), 4),
                    "lineupTargetShare": round(optimize_skill_lineup(players, "targetShare"), 4),
                    "lineupRedZoneOpportunities": round(optimize_skill_lineup(players, "redZoneOpportunities"), 4),
                    "lineupDepthScore": round(optimize_skill_lineup(players, "depthScore"), 4),
                    "trailingLineupSnapShare": round(optimize_skill_lineup(players, "trailingSnapShare"), 4),
                    "trailingLineupOpportunities": round(optimize_skill_lineup(players, "trailingOpportunities"), 4),
                    "trailingLineupRedZoneOpportunities": round(optimize_skill_lineup(players, "trailingRedZoneOpportunities"), 4),
                    "rosterOpportunityConcentration": round(
                        sum(opportunity_values[:3]) / sum(opportunity_values), 4
                    ) if sum(opportunity_values) else 0,
                    "targetPerOffensiveSnap": round(total_targets / total_snaps, 4) if total_snaps else 0,
                })
                audit["teamCheckpoints"] += 1
            checkpoints.append({
                "completedWeek": completed_week,
                "forecastWeek": completed_week + 1,
                "teams": teams,
            })

        output_seasons.append({
            "season": season,
            "audit": dict(audit),
            "checkpoints": checkpoints,
        })
        for key, value in audit.items():
            overall[key] += value
        print(f"{season}: {audit['teamCheckpoints']} team-checkpoints")

    payload = {
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "status": "research_only_not_used_by_live_simulator",
        "attribution": "NFL data provided by nflverse and its upstream sources under the nflverse-data licensing terms (CC BY 4.0 where indicated).",
        "forecastTiming": "A completed-Week N row uses only NFL usage through Week N and the Sleeper Week N roster snapshot.",
        "featureDefinitions": {
            "lineupSnapShare": "Maximum one-week offensive snap-share sum under the league's QB/2RB/2WR/TE/FLEX skill slots.",
            "lineupOpportunities": "Maximum one-week targets plus carries under the same slots.",
            "lineupTargetShare": "Maximum nflverse target-share sum under the same slots.",
            "lineupRedZoneOpportunities": "Maximum carries plus targets from the opponent 20 or closer under the same slots.",
            "lineupDepthScore": "Maximum inverse depth-team rank under the same slots (1, 0.5, 0.333, ...).",
            "trailing*": "Mean player usage across the last three available weeks, then optimized under the same slots.",
            "targetPerOffensiveSnap": "Roster targets divided by roster offensive snaps; a demand proxy, not routes run.",
        },
        "limitations": [
            "Direct routes run are not present in nflverse's public all-season player/snap/depth files; target-per-snap is explicitly a proxy.",
            "The nflverse depth-chart source changed in 2025 and no longer contains historical week values; 2025 depth scores are therefore left at zero rather than backfilled from a later snapshot.",
            "Usage is backward-looking and cannot encode injuries or role changes first known after the completed-week cutoff.",
            "PFR snap/depth identifiers are joined to Sleeper through nflverse weekly rosters; unmapped players contribute zero rather than guessed values.",
            "Team defenses and kickers are excluded because the requested role features are offensive player usage features.",
            "The output is research-only and is not imported by the production simulator.",
        ],
        "sources": source_urls,
        "audit": dict(overall),
        "seasons": output_seasons,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Saved {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
