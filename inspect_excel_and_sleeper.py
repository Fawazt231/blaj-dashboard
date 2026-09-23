import pandas as pd
import requests
import json
import os

EXCEL_PATH = "/Users/FawazTahir/Downloads/ff_report_with_playoffs_updated (2).xlsx"
SLEEPER_LEAGUE_ID = "1389388845572702208"

def inspect_excel():
    print("=== INSPECTING EXCEL FILE ===")
    if not os.path.exists(EXCEL_PATH):
        print(f"Error: Excel file not found at {EXCEL_PATH}")
        return []
    
    xl = pd.ExcelFile(EXCEL_PATH)
    print(f"Found sheets: {xl.sheet_names}\n")
    
    excel_names = set()
    for sheet in xl.sheet_names:
        df = xl.parse(sheet)
        print(f"--- Sheet: {sheet} (Shape: {df.shape}) ---")
        print(df.head(3))
        print()
        
        # Check column names or text entries for manager names
        for col in df.columns:
            if any(term in str(col).lower() for term in ['team', 'owner', 'manager', 'user', 'name', 'member']):
                unique_vals = df[col].dropna().astype(str).unique()
                for v in unique_vals:
                    excel_names.add(v.strip())
                    
    return list(excel_names)

def fetch_sleeper_history():
    print("\n=== FETCHING SLEEPER LEAGUE HISTORY ===")
    curr_id = SLEEPER_LEAGUE_ID
    seasons_data = []
    sleeper_users = {} # user_id -> set of display names
    
    while curr_id and curr_id != "0":
        print(f"Fetching league {curr_id}...")
        url = f"https://api.sleeper.app/v1/league/{curr_id}"
        resp = requests.get(url)
        if resp.status_code != 200:
            print(f"Failed to fetch league {curr_id}: {resp.status_code}")
            break
            
        data = resp.json()
        season = data.get("season")
        name = data.get("name")
        prev_id = data.get("previous_league_id")
        
        # Fetch users for this season
        users_resp = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}/users")
        users = users_resp.json() if users_resp.status_code == 200 else []
        
        # Fetch rosters for this season
        rosters_resp = requests.get(f"https://api.sleeper.app/v1/league/{curr_id}/rosters")
        rosters = rosters_resp.json() if rosters_resp.status_code == 200 else []
        
        season_users = []
        for u in users:
            uid = u.get("user_id")
            display_name = u.get("display_name")
            username = u.get("username")
            if uid not in sleeper_users:
                sleeper_users[uid] = set()
            if display_name: sleeper_users[uid].add(display_name)
            if username: sleeper_users[uid].add(username)
            
            season_users.append({
                "user_id": uid,
                "display_name": display_name,
                "username": username,
                "metadata_team_name": u.get("metadata", {}).get("team_name")
            })
            
        seasons_data.append({
            "season": season,
            "league_id": curr_id,
            "name": name,
            "users": season_users,
            "rosters_count": len(rosters)
        })
        
        curr_id = prev_id
        
    return seasons_data, sleeper_users

if __name__ == "__main__":
    excel_names = inspect_excel()
    seasons_data, sleeper_users = fetch_sleeper_history()
    
    print("\n=== SUMMARY OF UNIQUE USERS / NAMES FOUND ===")
    print("Sleeper Users:")
    for uid, names in sleeper_users.items():
        print(f"  User ID: {uid} -> Names/Usernames: {list(names)}")
        
    print("\nExcel Sheet Extracted Names (Sample):")
    print(excel_names[:20])
    
    # Output raw info to JSON for mapping creation
    with open("data_discovery.json", "w") as f:
        json.dump({
            "seasons": seasons_data,
            "sleeper_users": {uid: list(names) for uid, names in sleeper_users.items()},
            "excel_names": excel_names
        }, f, indent=2)
    print("\nSaved discovery data to data_discovery.json")
