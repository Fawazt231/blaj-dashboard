export function calculateProjectedPoints(stats = {}, scoringSettings = {}) {
  return Object.entries(scoringSettings).reduce((total, [stat, value]) => {
    const projectedStat = Number(stats?.[stat]);
    const scoringValue = Number(value);
    if (!Number.isFinite(projectedStat) || !Number.isFinite(scoringValue)) return total;
    return total + projectedStat * scoringValue;
  }, 0);
}

export function buildProjectionLookup(rows = [], playerIds = [], scoringSettings = {}) {
  const wanted = new Set(playerIds.map(String));
  const projections = {};

  rows.forEach(row => {
    const playerId = String(row?.player_id || '');
    if (!wanted.has(playerId)) return;
    projections[playerId] = calculateProjectedPoints(row?.stats, scoringSettings);
  });

  return projections;
}

export function projectedLineupTotal(starters = [], projections = null) {
  if (!projections || !Array.isArray(starters) || starters.length === 0) return null;
  const found = starters.filter(playerId => Object.prototype.hasOwnProperty.call(projections, String(playerId)));
  if (found.length === 0) return null;
  return found.reduce((total, playerId) => total + Number(projections[String(playerId)] || 0), 0);
}
