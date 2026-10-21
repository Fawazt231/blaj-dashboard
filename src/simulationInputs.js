export function collectCompletedWeeklyScores(matchupsByWeek = {}, currentWeek = 1) {
  const scoresByTeam = {};

  Object.entries(matchupsByWeek).forEach(([weekKey, pairs]) => {
    if (Number(weekKey) >= Number(currentWeek)) return;

    (pairs || []).forEach(pair => {
      if (!Array.isArray(pair)) return;
      pair.forEach(entry => {
        const name = entry?.team_info?.canonical_name;
        const score = Number(entry?.points);
        if (!name || !Number.isFinite(score)) return;
        if (!scoresByTeam[name]) scoresByTeam[name] = [];
        scoresByTeam[name].push(score);
      });
    });
  });

  return scoresByTeam;
}
