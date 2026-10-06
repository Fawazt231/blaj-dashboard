import pandas as pd
import requests
import json
import os
import math
import random
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXCEL_PATH = os.environ.get(
    "BLAJ_EXCEL_PATH",
    "/Users/FawazTahir/ffScripts/ff_report_with_playoffs_updated_FINAL_RECALC.xlsx"
)
CURRENT_LEAGUE_ID = "1389388845572702208"
MANAGERS_FILE = os.path.join(BASE_DIR, "managers.json")
OUTPUT_DIR = os.path.join(BASE_DIR, "public", "data")

os.makedirs(OUTPUT_DIR, exist_ok=True)

# Load manager mapping
with open(MANAGERS_FILE, "r") as f:
    manager_config = json.load(f)

name_map = {}
for uid, info in manager_config["users"].items():
    cname = info["canonical_name"]
    name_map[uid] = cname
    name_map[cname.lower()] = cname
    for u in info.get("usernames", []):
        name_map[u.lower()] = cname
    for e in info.get("excel_names", []):
        name_map[e.lower()] = cname

for k, v in manager_config.get("legacy_only_managers", {}).items():
    name_map[k.lower()] = v

def get_canonical(name_or_id):
    if not name_or_id:
        return "Unknown"
    s = str(name_or_id).strip().lower()
    return name_map.get(s, str(name_or_id).strip())

def build_playoff_odds_snapshot(live_data, history_data, completed_week, simulations=10000):
    """Rebuild a deterministic end-of-week playoff simulation snapshot."""
    season = int(live_data.get("season", 0))
    standings = live_data.get("standings", [])
    logs = [
        game for game in history_data.get("MatchLog_PlayoffIncluded", [])
        if int(game.get("season", 0)) == season
        and int(game.get("week", 0)) <= completed_week
        and str(game.get("game_type", "regular")).lower() == "regular"
    ]
    proxies = {row.get("manager"): row for row in history_data.get("PerManagerSummary", [])}

    teams = []
    for standing in standings:
        name = standing.get("canonical_name")
        team_games = [g for g in logs if name in (g.get("awayTeamName"), g.get("homeTeamName"))]
        wins = sum(1 for g in team_games if g.get("winner") == name)
        losses = sum(1 for g in team_games if g.get("loser") == name)
        points = sum(
            float(g.get("awayScore", 0)) if g.get("awayTeamName") == name else float(g.get("homeScore", 0))
            for g in team_games
        )
        proxy = proxies.get(name, {})
        historical_avg = max(100.0, float(proxy.get("highest_score", 0)) * 0.7) if proxy else 110.0
        total_games = wins + losses
        raw_mean = points / total_games if total_games else historical_avg
        std = max(math.sqrt(max(raw_mean, 1.0)) * 1.5, 16.0)
        prior_mean, prior_std, min_sigma = 115.0, 25.0, 20.0
        if total_games:
            prior_var = prior_std ** 2
            obs_var = max(std ** 2, min_sigma ** 2)
            post_var = 1.0 / (1.0 / prior_var + total_games / obs_var)
            mean = post_var * (prior_mean / prior_var + total_games * raw_mean / obs_var)
            std = math.sqrt(obs_var + post_var)
        else:
            mean = 0.5 * raw_mean + 0.5 * prior_mean
            std = prior_std
        teams.append({
            "name": name,
            "wins": wins,
            "losses": losses,
            "fpts": points,
            "mean": mean,
            "std": std,
            "division": standing.get("division", 1),
        })

    remaining_schedule = []
    for week_key, pairs in live_data.get("matchups_by_week", {}).items():
        if int(week_key) <= completed_week:
            continue
        for pair in pairs or []:
            if len(pair) < 2:
                continue
            away = pair[0].get("team_info", {}).get("canonical_name")
            home = pair[1].get("team_info", {}).get("canonical_name")
            if away and home:
                remaining_schedule.append((away, home))

    counters = {
        "playoff": defaultdict(int), "bye": defaultdict(int),
        "division": defaultdict(int), "last": defaultdict(int),
        "wins": defaultdict(float), "points": defaultdict(float),
    }
    rng = random.Random(season * 100000 + completed_week * 100 + simulations)
    divisions = defaultdict(list)
    for team in teams:
        divisions[team["division"]].append(team["name"])

    for _ in range(simulations):
        state = {team["name"]: dict(team) for team in teams}
        for away_name, home_name in remaining_schedule:
            away, home = state.get(away_name), state.get(home_name)
            if not away or not home:
                continue
            away_score = rng.gauss(away["mean"], away["std"])
            home_score = rng.gauss(home["mean"], home["std"])
            away["fpts"] += away_score
            home["fpts"] += home_score
            if away_score > home_score:
                away["wins"] += 1
                home["losses"] += 1
            else:
                home["wins"] += 1
                away["losses"] += 1

        values = list(state.values())
        last = min(values, key=lambda t: (t["wins"], t["fpts"]))
        counters["last"][last["name"]] += 1

        division_winners = []
        for members in divisions.values():
            candidates = [state[name] for name in members if name in state]
            if candidates:
                winner = max(candidates, key=lambda t: (t["wins"], t["fpts"]))
                division_winners.append(winner)
                counters["division"][winner["name"]] += 1
        division_winners.sort(key=lambda t: (t["wins"], t["fpts"]), reverse=True)
        for team in division_winners[:2]:
            counters["bye"][team["name"]] += 1

        winner_names = {team["name"] for team in division_winners}
        pool = sorted(
            [team for team in values if team["name"] not in winner_names],
            key=lambda t: (t["wins"], t["fpts"]), reverse=True,
        )
        fourth_seed = pool[:1]
        point_qualifiers = sorted(pool[1:], key=lambda t: t["fpts"], reverse=True)[:2]
        for team in division_winners + fourth_seed + point_qualifiers:
            counters["playoff"][team["name"]] += 1
        for team in values:
            counters["wins"][team["name"]] += team["wins"]
            counters["points"][team["name"]] += team["fpts"]

    results = []
    for team in teams:
        name = team["name"]
        results.append({
            "name": name,
            "playoffCount": counters["playoff"][name],
            "playoffPct": round(counters["playoff"][name] / simulations * 100, 1),
            "byeCount": counters["bye"][name],
            "byePct": round(counters["bye"][name] / simulations * 100, 1),
            "divWinnerCount": counters["division"][name],
            "divWinnerPct": round(counters["division"][name] / simulations * 100, 1),
            "lastCount": counters["last"][name],
            "lastPct": round(counters["last"][name] / simulations * 100, 1),
            "projWins": round(counters["wins"][name] / simulations, 1),
            "projFpts": round(counters["points"][name] / simulations, 1),
        })
    results.sort(key=lambda row: (row["playoffPct"], row["projWins"]), reverse=True)
    return {
        "weekCompleted": completed_week,
        "simulations": simulations,
        "model": "Bayesian",
        "seed": season * 100000 + completed_week * 100 + simulations,
        "results": results,
    }

def update_playoff_odds_history(live_data):
    history_path = os.path.join(OUTPUT_DIR, "excel_history.json")
    odds_path = os.path.join(OUTPUT_DIR, "playoff_odds_history.json")
    with open(history_path, "r") as stream:
        history_data = json.load(stream)
    season = str(live_data.get("season"))
    completed_week = max(1, int(live_data.get("current_week", 1)) - 1)
    odds_history = {"season": season, "snapshots": {}}
    if os.path.exists(odds_path):
        with open(odds_path, "r") as stream:
            existing = json.load(stream)
        if str(existing.get("season")) == season:
            odds_history = existing
    snapshots = odds_history.setdefault("snapshots", {})
    for week in range(1, completed_week + 1):
        key = str(week)
        if key not in snapshots:
            snapshots[key] = build_playoff_odds_snapshot(live_data, history_data, week)
            snapshots[key]["source"] = "reconstructed" if week < completed_week else "weekly_update"
    with open(odds_path, "w") as stream:
        json.dump(odds_history, stream, indent=2)
    live_data["playoff_odds_history"] = odds_history
    print(f"Saved playoff odds snapshots through completed Week {completed_week}.")

def build_full_history():
    print("Building Full Historical Record Book via Sleeper API + Legacy Base...")
    
    all_logs = []
    
    # 1. Legacy 2017 & 2018 logs from Excel
    xl = pd.ExcelFile(EXCEL_PATH)
    df_excel_logs = xl.parse("MatchLog_PlayoffIncluded")
    legacy_logs_raw = df_excel_logs[df_excel_logs["season"].isin([2017, 2018])].to_dict(orient="records")
    
    for r in legacy_logs_raw:
        away = get_canonical(r.get("awayManager") or r.get("awayTeamName"))
        home = get_canonical(r.get("homeManager") or r.get("homeTeamName"))
        winner = away if r.get("awayWon") else (home if r.get("homeWon") else None)
        loser = home if r.get("awayWon") else (away if r.get("homeWon") else None)
        
        gtype = str(r.get("game_type") or "regular").lower()
        is_champ = (gtype == "playoff" and int(r["week"]) == 16)
        
        all_logs.append({
            "season": int(r["season"]),
            "week": int(r["week"]),
            "awayTeamName": away,
            "homeTeamName": home,
            "awayScore": round(float(r["awayScore"]), 2) if r.get("awayScore") is not None else 0.0,
            "homeScore": round(float(r["homeScore"]), 2) if r.get("homeScore") is not None else 0.0,
            "winner": winner,
            "loser": loser,
            "margin": round(float(r.get("margin") or abs(float(r.get("awayScore", 0)) - float(r.get("homeScore", 0)))), 2),
            "tie": bool(r.get("tie")),
            "game_type": str(r.get("game_type") or "regular").lower(),
            "is_championship": is_champ
        })

    # 2. Fetch 2019 - Present from Sleeper API
    curr_id = CURRENT_LEAGUE_ID
    while curr_id and curr_id != "0":
        l_res = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}").json()
        season = int(l_res.get("season"))
        
        print(f"Fetching Sleeper season {season} (League {curr_id})...")
        users = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}/users").json()
        rosters = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}/rosters").json()
        playoff_start_week = l_res.get("settings", {}).get("playoff_week_start", 15)
        
        user_map = {u["user_id"]: get_canonical(u.get("display_name") or u.get("username")) for u in users}
        roster_map = {r["roster_id"]: user_map.get(r.get("owner_id"), "Unknown") for r in rosters}
        
        # A. Regular Season Games (Weeks 1 to playoff_start_week - 1)
        for wk in range(1, playoff_start_week):
            res = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}/matchups/{wk}")
            if res.status_code != 200: continue
            matchups = res.json()
            if not matchups: continue
            
            grouped = {}
            for m in matchups:
                mid = m.get("matchup_id")
                if mid: grouped.setdefault(mid, []).append(m)
                
            for mid, pair in grouped.items():
                if len(pair) < 2: continue
                tA, tB = pair[0], pair[1]
                nA, nB = roster_map.get(tA.get("roster_id"), "Unknown"), roster_map.get(tB.get("roster_id"), "Unknown")
                pA, pB = round(float(tA.get("points") or 0.0), 2), round(float(tB.get("points") or 0.0), 2)
                if pA == 0.0 and pB == 0.0: continue
                
                winner = nA if pA > pB else (nB if pB > pA else None)
                loser = nB if pA > pB else (nA if pB > pA else None)
                
                all_logs.append({
                    "season": season,
                    "week": wk,
                    "awayTeamName": nA,
                    "homeTeamName": nB,
                    "awayScore": pA,
                    "homeScore": pB,
                    "winner": winner,
                    "loser": loser,
                    "margin": round(abs(pA - pB), 2),
                    "tie": (pA == pB),
                    "game_type": "regular"
                })

        # B. Official Playoff Games via winners_bracket
        bracket_res = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}/winners_bracket")
        if bracket_res.status_code == 200:
            bracket = bracket_res.json()
            for b_match in bracket:
                # Ignore 3rd place and 5th place consolation matches
                if b_match.get("p") in [3, 5]:
                    continue
                    
                r_num = b_match.get("r", 1)
                wk = playoff_start_week + (r_num - 1)
                
                # Fetch week scores
                w_res = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}/matchups/{wk}")
                if w_res.status_code != 200: continue
                wk_matchups = w_res.json()
                if not wk_matchups: continue
                
                ridA, ridB = b_match.get("t1"), b_match.get("t2")
                if not ridA or not ridB: continue
                
                nA, nB = roster_map.get(ridA, "Unknown"), roster_map.get(ridB, "Unknown")
                mA = [m for m in wk_matchups if m.get("roster_id") == ridA]
                mB = [m for m in wk_matchups if m.get("roster_id") == ridB]
                if not mA or not mB: continue
                
                pA = round(float(mA[0].get("points") or 0.0), 2)
                pB = round(float(mB[0].get("points") or 0.0), 2)
                if pA == 0.0 and pB == 0.0: continue
                
                w_rid = b_match.get("w")
                l_rid = b_match.get("l")
                winner = roster_map.get(w_rid) if w_rid else (nA if pA > pB else nB)
                loser = roster_map.get(l_rid) if l_rid else (nB if pA > pB else nA)
                is_champ = (b_match.get("p") == 1)
                
                all_logs.append({
                    "season": season,
                    "week": wk,
                    "awayTeamName": nA,
                    "homeTeamName": nB,
                    "awayScore": pA,
                    "homeScore": pB,
                    "winner": winner,
                    "loser": loser,
                    "margin": round(abs(pA - pB), 2),
                    "tie": (pA == pB),
                    "game_type": "playoff",
                    "is_championship": is_champ,
                    "round": r_num
                })
                
        curr_id = l_res.get("previous_league_id")

    # Sort all match logs by season DESC, week ASC
    all_logs.sort(key=lambda x: (-x["season"], x["week"]))
    
    # 3. Dynamic Calculation of All 8 Sheets
    reg_logs = [l for l in all_logs if l["game_type"] == "regular"]
    playoff_logs = [l for l in all_logs if l["game_type"] == "playoff"]
    
    # Managers list
    managers = sorted(list(set([l["awayTeamName"] for l in all_logs] + [l["homeTeamName"] for l in all_logs])))
    per_manager_summary = []
    playoff_summary = []
    
    for m in managers:
        m_reg = [l for l in reg_logs if l["awayTeamName"] == m or l["homeTeamName"] == m]
        m_all = [l for l in all_logs if l["awayTeamName"] == m or l["homeTeamName"] == m]
        m_p = [l for l in playoff_logs if l["awayTeamName"] == m or l["homeTeamName"] == m]
        
        wins = sum(1 for l in m_reg if l["winner"] == m)
        losses = sum(1 for l in m_reg if l["loser"] == m)
        ties = sum(1 for l in m_reg if l["tie"])
        tot_games = wins + losses + ties
        win_pct = round(wins / tot_games, 4) if tot_games > 0 else 0.0
        
        # High/Low scores
        scores = []
        for l in m_all:
            s = l["awayScore"] if l["awayTeamName"] == m else l["homeScore"]
            scores.append(s)
            
        hi_score = max(scores) if scores else 0.0
        lo_score = min(scores) if scores else 0.0
        
        # Week 1 record
        w1_games = [l for l in m_reg if l["week"] == 1]
        w1_wins = sum(1 for l in w1_games if l["winner"] == m)
        w1_losses = sum(1 for l in w1_games if l["loser"] == m)
        w1_ties = sum(1 for l in w1_games if l["tie"])
        w1_rec = f"{w1_wins}-{w1_losses}-{w1_ties}"
        
        # Playoff stats
        p_wins = sum(1 for l in m_p if l["winner"] == m)
        p_losses = sum(1 for l in m_p if l["loser"] == m)
        p_tot = len(m_p)
        p_win_pct = round(p_wins / p_tot, 4) if p_tot > 0 else 0.0
        p_seasons = len(set(l["season"] for l in m_p))
        
        # Championship stats (Only count games where place == 1 in winners_bracket)
        champ_games = [l for l in m_p if l.get("is_championship")]
        champ_wins = sum(1 for l in champ_games if l["winner"] == m)
        champ_apps = len(champ_games)
        
        # Round 2 Appearances (Unique seasons manager reached Round 2 / Semifinals or Bye into SF)
        rd2_seasons = len(set(l["season"] for l in m_p if l.get("round") == 2 or (l["season"] in [2017, 2018] and l["week"] == 15)))
        
        per_manager_summary.append({
            "manager": m,
            "all_time_record": f"{wins}-{losses}-{ties}",
            "regular_season_win_pct": win_pct,
            "total_games": tot_games,
            "highest_score": hi_score,
            "lowest_score": lo_score,
            "week1_record": w1_rec,
            "playoff_appearances": p_seasons
        })
        
        if p_tot > 0:
            playoff_summary.append({
                "manager": m,
                "playoff_appearances": p_seasons,
                "playoff_games": p_tot,
                "playoff_wins": p_wins,
                "playoff_losses": p_losses,
                "playoff_win_pct": p_win_pct,
                "round2_appearances": rd2_seasons,
                "championship_appearances": champ_apps,
                "championship_wins": champ_wins
            })
            
    per_manager_summary.sort(key=lambda x: x["regular_season_win_pct"], reverse=True)
    playoff_summary.sort(key=lambda x: (x["championship_wins"], x["playoff_wins"]), reverse=True)
    
    # Pairwise H2H tables
    def calculate_h2h(log_list):
        h2h_data = []
        for m1 in managers:
            for m2 in managers:
                if m1 == m2: continue
                m_games = [l for l in log_list if (l["awayTeamName"] == m1 and l["homeTeamName"] == m2) or (l["awayTeamName"] == m2 and l["homeTeamName"] == m1)]
                if not m_games: continue
                w = sum(1 for l in m_games if l["winner"] == m1)
                l = sum(1 for l in m_games if l["winner"] == m2)
                t = sum(1 for l in m_games if l["tie"])
                h2h_data.append({
                    "manager": m1,
                    "opponent": m2,
                    "W": w,
                    "L": l,
                    "T": t,
                    "meetings_total": len(m_games)
                })
        return h2h_data

    def calculate_h2h_last5(log_list):
        h2h_last5 = []
        for m1 in managers:
            for m2 in managers:
                if m1 == m2: continue
                m_games = [l for l in log_list if (l["awayTeamName"] == m1 and l["homeTeamName"] == m2) or (l["awayTeamName"] == m2 and l["homeTeamName"] == m1)]
                if not m_games: continue
                last5 = m_games[:5]
                w = sum(1 for l in last5 if l["winner"] == m1)
                l = sum(1 for l in last5 if l["winner"] == m2)
                t = sum(1 for l in last5 if l["tie"])
                h2h_last5.append({
                    "manager": m1,
                    "opponent": m2,
                    "last5_W": w,
                    "last5_L": l,
                    "last5_T": t,
                    "meetings_considered": len(last5)
                })
        return h2h_last5

    def calculate_top10_seasons(log_list):
        season_stats = {}
        for m in log_list:
            season = m["season"]
            for side in ["away", "home"]:
                mgr = m[f"{side}TeamName"]
                pts = float(m[f"{side}Score"])
                key = (season, mgr)
                if key not in season_stats:
                    season_stats[key] = {"season": season, "manager": mgr, "total_points": 0.0, "games_played": 0}
                season_stats[key]["total_points"] += pts
                season_stats[key]["games_played"] += 1
                
        results = []
        for key, s in season_stats.items():
            avg_pts = round(s["total_points"] / s["games_played"], 2) if s["games_played"] > 0 else 0.0
            results.append({
                "season": s["season"],
                "manager": s["manager"],
                "avg_points_per_game": avg_pts,
                "total_points": round(s["total_points"], 2),
                "games_played": s["games_played"]
            })
        results.sort(key=lambda x: x["avg_points_per_game"], reverse=True)
        return results[:10]

    data_export = {
        "PerManagerSummary": per_manager_summary,
        "PlayoffSummary": playoff_summary,
        "Top10_Seasons_Reg": calculate_top10_seasons(reg_logs),
        "Top10_Seasons_InclPlayoffs": calculate_top10_seasons(all_logs),
        "H2H_AllTime": calculate_h2h(reg_logs),
        "H2H_Last5": calculate_h2h_last5(reg_logs),
        "H2H_AllTime_PlayoffIncluded": calculate_h2h(all_logs),
        "H2H_Last5_PlayoffIncluded": calculate_h2h_last5(all_logs),
        "MatchLog": all_logs,
        "MatchLog_PlayoffIncluded": all_logs
    }
    
    with open(os.path.join(OUTPUT_DIR, "excel_history.json"), "w") as f:
        json.dump(data_export, f, indent=2)
    print("Saved automated excel_history.json successfully!")

def fetch_sleeper_history_and_live():
    print("Fetching Sleeper API History and Live Data...")
    
    curr_id = CURRENT_LEAGUE_ID
    champions_by_year = []
    
    legacy_champions = [
        {"season": 2018, "champion": "Fawaz", "team_name": "Graham Crackers", "canonical_name": get_canonical("Fawaz")},
        {"season": 2017, "champion": "GeneralSod", "team_name": "Abrakadabra Alakamara", "canonical_name": get_canonical("GeneralSod")}
    ]
    
    while curr_id and curr_id != "0":
        l_res = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}").json()
        season = int(l_res.get("season"))
        
        bracket = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}/winners_bracket").json()
        users = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}/users").json()
        rosters = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}/rosters").json()
        
        user_map = {}
        team_name_map = {}
        for u in users:
            uid = u["user_id"]
            dname = u.get("display_name") or u.get("username") or "Unknown"
            tname = u.get("metadata", {}).get("team_name") or dname
            user_map[uid] = dname
            team_name_map[uid] = tname
            
        roster_map = {r["roster_id"]: user_map.get(r.get("owner_id"), "Unknown") for r in rosters}
        roster_team_map = {r["roster_id"]: team_name_map.get(r.get("owner_id"), "Unknown Team") for r in rosters}
        
        champ_game = [m for m in bracket if m.get("p") == 1]
        champ_name = None
        if champ_game:
            w_rid = champ_game[0].get("w")
            if w_rid:
                champ_name = roster_map.get(w_rid, "Unknown")
                team_name = roster_team_map.get(w_rid, champ_name)
                champions_by_year.append({
                    "season": season,
                    "champion": champ_name,
                    "team_name": team_name,
                    "canonical_name": get_canonical(champ_name),
                    "league_id": curr_id
                })
                
        curr_id = l_res.get("previous_league_id")
        
    champions_by_year.extend(legacy_champions)
    champions_by_year.sort(key=lambda x: x["season"], reverse=True)
    
    league_url = f"https://api.sleeper.app/v1/league/{CURRENT_LEAGUE_ID}"
    league_res = requests.get(league_url).json()
    total_weeks = league_res.get("settings", {}).get("playoff_week_start", 15) - 1
    league_settings = league_res.get("settings", {})
    current_leg = int(league_settings.get("leg") or 1)
    last_scored_leg = int(league_settings.get("last_scored_leg") or 0)
    
    users_url = f"https://api.sleeper.app/v1/league/{CURRENT_LEAGUE_ID}/users"
    users_data = requests.get(users_url).json()
    user_map = {}
    for u in users_data:
        uid = u["user_id"]
        cname = get_canonical(uid)
        display_name = u.get("display_name") or u.get("username") or "Unknown"
        avatar = u.get("avatar")
        avatar_url = f"profile-images-removed/thumbs/{avatar}" if avatar else None
        user_map[uid] = {
            "canonical_name": cname,
            "display_name": display_name,
            "avatar_url": avatar_url,
            "team_name": u.get("metadata", {}).get("team_name") or display_name
        }
        
    rosters_url = f"https://api.sleeper.app/v1/league/{CURRENT_LEAGUE_ID}/rosters"
    rosters_data = requests.get(rosters_url).json()
    
    roster_map = {}
    standings = []
    
    for r in rosters_data:
        rid = r["roster_id"]
        owner_id = r.get("owner_id")
        user_info = user_map.get(owner_id, {
            "canonical_name": "Unknown",
            "display_name": "Unknown",
            "avatar_url": None,
            "team_name": "Unknown Team"
        })
        
        s = r.get("settings", {})
        wins = s.get("wins", 0)
        losses = s.get("losses", 0)
        ties = s.get("ties", 0)
        fpts = round(float(s.get("fpts", 0)) + (float(s.get("fpts_decimal", 0)) / 100.0), 2)
        fpts_against = round(float(s.get("fpts_against", 0)) + (float(s.get("fpts_against_decimal", 0)) / 100.0), 2)
        division = s.get("division", 1)
        
        roster_info = {
            "roster_id": rid,
            "owner_id": owner_id,
            "canonical_name": user_info["canonical_name"],
            "display_name": user_info["display_name"],
            "team_name": user_info["team_name"],
            "avatar_url": user_info["avatar_url"],
            "wins": wins,
            "losses": losses,
            "ties": ties,
            "points_for": fpts,
            "points_against": fpts_against,
            "division": division
        }
        roster_map[rid] = roster_info
        standings.append(roster_info)
        
    standings.sort(key=lambda x: (x["wins"], x["points_for"]), reverse=True)
    for idx, s in enumerate(standings, 1):
        s["rank"] = idx

    div_groups = {}
    for team in standings:
        div = team["division"]
        div_groups.setdefault(div, []).append(team)
        
    div_winners = []
    for div, teams in div_groups.items():
        sorted_div = sorted(teams, key=lambda x: (x["wins"], x["points_for"]), reverse=True)
        div_winners.append(sorted_div[0])
        
    div_winners.sort(key=lambda x: (x["wins"], x["points_for"]), reverse=True)
    seed1, seed2, seed3 = div_winners[0], div_winners[1], div_winners[2]
    
    remaining = [t for t in standings if t not in [seed1, seed2, seed3]]
    remaining.sort(key=lambda x: (x["wins"], x["points_for"]), reverse=True)
    seed4 = remaining[0]
    
    remaining_after_seed4 = [t for t in remaining if t != seed4]
    remaining_after_seed4.sort(key=lambda x: x["points_for"], reverse=True)
    seed5, seed6 = remaining_after_seed4[0], remaining_after_seed4[1]
    
    playoff_seeds = [
        {"seed": 1, "type": "Division Winner", "team": seed1},
        {"seed": 2, "type": "Division Winner", "team": seed2},
        {"seed": 3, "type": "Division Winner", "team": seed3},
        {"seed": 4, "type": "Wildcard (Record)", "team": seed4},
        {"seed": 5, "type": "Points For Qualifier", "team": seed5},
        {"seed": 6, "type": "Points For Qualifier", "team": seed6},
    ]
    
    punishment_watch = standings[-3:]
    
    matchups_by_week = {}
    current_week = max(current_leg, last_scored_leg + 1, 1)
    
    for wk in range(1, 15):
        m_url = f"https://api.sleeper.app/v1/league/{CURRENT_LEAGUE_ID}/matchups/{wk}"
        m_res = requests.get(m_url)
        if m_res.status_code == 200:
            m_data = m_res.json()
            grouped = {}
            for item in m_data:
                mid = item.get("matchup_id")
                if not mid: continue
                rid = item.get("roster_id")
                pts = round(float(item.get("points") or 0.0), 2)
                team_info = roster_map.get(rid, {})
                grouped.setdefault(mid, []).append({
                    "roster_id": rid,
                    "team_info": team_info,
                    "points": pts,
                    "starters": item.get("starters"),
                    "starters_points": item.get("starters_points")
                })
            matchups_by_week[wk] = list(grouped.values())

    live_export = {
        "league_name": league_res.get("name"),
        "season": league_res.get("season"),
        "current_week": current_week,
        "total_weeks": total_weeks,
        "standings": standings,
        "playoff_picture": playoff_seeds,
        "punishment_watch": punishment_watch,
        "matchups_by_week": matchups_by_week,
        "champions_history": champions_by_year,
        "odds_movers": None
    }

    update_playoff_odds_history(live_export)
    
    with open(os.path.join(OUTPUT_DIR, "live_sleeper_data.json"), "w") as f:
        json.dump(live_export, f, indent=2)
    print("Saved live_sleeper_data.json successfully!")

if __name__ == "__main__":
    build_full_history()
    fetch_sleeper_history_and_live()
