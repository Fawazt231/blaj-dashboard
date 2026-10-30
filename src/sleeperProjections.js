const FIRST_DOWN_RATES = Object.freeze({
  // Opportunity-weighted rates from Sleeper's completed 2022-2026 stats.
  QB: { rush: 0.302, rec: 0.133 },
  RB: { rush: 0.193, rec: 0.284 },
  WR: { rush: 0.263, rec: 0.523 },
  TE: { rush: 0.343, rec: 0.441 }
});

function projectionStats(stats = {}, position = '') {
  const adjusted = { ...stats };
  const rates = FIRST_DOWN_RATES[String(position || '').toUpperCase()] || FIRST_DOWN_RATES.WR;

  // Sleeper's projection feed currently populates rush_fd and rec_fd with the
  // yardage fantasy-point value (yards / 10), not projected first downs. Its
  // completed-game stats contain genuine integer first-down counts. Detect the
  // projection-feed alias and replace it with a conservative opportunity-based
  // estimate so first-down leagues are not double-charged for yardage.
  const rushYardsValue = Number(stats.rush_yd) * 0.1;
  if (Number.isFinite(rushYardsValue) && Math.abs(Number(stats.rush_fd) - rushYardsValue) < 0.015) {
    adjusted.rush_fd = Number(stats.rush_att || 0) * rates.rush;
  }
  const receivingYardsValue = Number(stats.rec_yd) * 0.1;
  if (Number.isFinite(receivingYardsValue) && Math.abs(Number(stats.rec_fd) - receivingYardsValue) < 0.015) {
    adjusted.rec_fd = Number(stats.rec || 0) * rates.rec;
  }
  return adjusted;
}

export function calculateProjectedPoints(stats = {}, scoringSettings = {}, options = {}) {
  const scoredStats = options.projectionFeed ? projectionStats(stats, options.position) : stats;
  return Object.entries(scoringSettings).reduce((total, [stat, value]) => {
    const projectedStat = Number(scoredStats?.[stat]);
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
    projections[playerId] = calculateProjectedPoints(row?.stats, scoringSettings, {
      projectionFeed: true,
      position: row?.player?.position
    });
  });

  return projections;
}

export function buildProjectionTeamLookup(rows = [], playerIds = []) {
  const wanted = new Set(playerIds.map(String));
  return Object.fromEntries(rows
    .filter(row => wanted.has(String(row?.player_id || '')))
    .map(row => [String(row.player_id), String(row?.team || row?.player?.team || '')]));
}

export function projectedLineupTotal(starters = [], projections = null, options = {}) {
  if (!projections || !Array.isArray(starters) || starters.length === 0) return null;
  const found = starters.filter(playerId => Object.prototype.hasOwnProperty.call(projections, String(playerId)));
  if (found.length === 0) return null;
  const actualPoints = options.actualPoints || {};
  const playerTeams = options.playerTeams || {};
  const gameStatuses = options.gameStatuses || {};
  return found.reduce((total, playerId) => {
    const key = String(playerId);
    const projection = Number(projections[key] || 0);
    const actual = Number(actualPoints[key] || 0);
    const status = String(gameStatuses[playerTeams[key]] || 'pre_game').toLowerCase();
    if (['complete', 'final', 'post_game'].includes(status)) return total + actual;
    // Sleeper does not expose a reliable live-game clock in this feed. During
    // a game, never project a player below points already scored; completed
    // games switch fully to their authoritative actual score above.
    if (['in_progress', 'in_game', 'live'].includes(status)) return total + Math.max(actual, projection);
    return total + projection;
  }, 0);
}
