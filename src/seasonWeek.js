export function resolveCurrentWeek(sleeperLeague, fallbackWeek = 1) {
  const settings = sleeperLeague?.settings || {};
  const leagueLeg = Number(settings.leg || fallbackWeek || 1);
  const lastScoredLeg = Number(settings.last_scored_leg || 0);

  // Sleeper can leave `leg` on the completed week after scoring is finalized.
  // In that window, the next week is already the correct preview/simulation week.
  return Math.max(1, leagueLeg, lastScoredLeg > 0 ? lastScoredLeg + 1 : 1);
}
