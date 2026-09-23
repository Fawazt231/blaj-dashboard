# Blaj Fantasy Football Dashboard

A modern, minimalist fantasy football league website for the **Blaj** league.

## 🚀 Features

- **Home Dashboard**:
  - **Live Standings Sidebar**: Auto-updated from Sleeper API.
  - **Punishment Watch**: Red-highlighted box tracking the bottom 3 seeds in danger of the league punishment.
  - **Weekly Matchups Hub**: Select any week (1–14) to view matchup projections and all-time Head-to-Head series records calculated from historical match logs.
  - **Custom Playoff Picture**: Seeds 1–3 (Division Leaders), Seed 4 (Wildcard), Seeds 5–6 (Highest PF among remaining teams).
  - **Punishment Calendar Shoot Sidebar**: Dedicated sidebar card with 12 clickable month previews to showcase the punishment calendar shoot photos.
- **Record Book**:
  - Full access to historical Excel sheets (`PerManagerSummary`, `H2H_AllTime`, `H2H_Last5`, `MatchLog`, `PlayoffSummary`, `MatchLog_PlayoffIncluded`).
  - **Search & Filtering**: Instant global text search across all rows.
  - **Column Sorting**: Click any column header to sort in ascending or descending order.
  - Clean flex-wrapped sheet navigation buttons.
- **Hall of Champions**:
  - Exclusively honors actual champions (`championship_wins > 0`) with trophy counts, playoff appearances, and championship game totals.

---

## 📷 Adding Calendar Shoot Photos

To populate the **Punishment Calendar Shoot** images:
1. Save your photo files inside the `public/calendar/` directory.
2. Name them `month_1.jpg`, `month_2.jpg`, `month_3.jpg`, ... up to `month_12.jpg`.

---

## 🛠️ Data Pipeline & Updating Data

Whenever you want to fetch fresh Sleeper data during the season:

```bash
# Run the Python data script
/Users/FawazTahir/Projects/blaj-dashboard/venv/bin/python /Users/FawazTahir/Projects/blaj-dashboard/build_dashboard_data.py
```

This will automatically refresh `live_sleeper_data.json` and `excel_history.json` in `public/data/`.

---

## 🏃 Running Locally

```bash
# Start local server
npm run dev
```

Visit `http://localhost:3000` in your browser.
