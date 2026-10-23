const DAY_MS = 24 * 60 * 60 * 1000;

export function transactionEffectiveAt(transaction) {
  const existing = Number(transaction?.effectiveAt);
  if (Number.isFinite(existing) && existing > 0) {
    return {
      timestamp: existing,
      source: transaction?.effectiveAtSource || 'normalized'
    };
  }
  const updated = Number(transaction?.status_updated ?? transaction?.statusUpdated);
  if (Number.isFinite(updated) && updated > 0) {
    return { timestamp: updated, source: 'status_updated' };
  }
  const created = Number(transaction?.created);
  if (Number.isFinite(created) && created > 0) {
    return { timestamp: created, source: 'created_fallback' };
  }
  return { timestamp: null, source: 'missing' };
}

export function normalizeTransaction(transaction) {
  const effective = transactionEffectiveAt(transaction);
  return {
    transactionId: String(transaction?.transaction_id ?? transaction?.transactionId ?? ''),
    type: transaction?.type || 'unknown',
    status: transaction?.status || 'unknown',
    leg: Number(transaction?.leg),
    created: Number(transaction?.created) || null,
    statusUpdated: Number(transaction?.status_updated ?? transaction?.statusUpdated) || null,
    effectiveAt: effective.timestamp,
    effectiveAtSource: effective.source,
    rosterIds: (transaction?.roster_ids ?? transaction?.rosterIds ?? []).map(Number).filter(Number.isFinite),
    adds: transaction?.adds && typeof transaction.adds === 'object'
      ? Object.fromEntries(Object.entries(transaction.adds).map(([playerId, rosterId]) => [String(playerId), Number(rosterId)]))
      : {},
    drops: transaction?.drops && typeof transaction.drops === 'object'
      ? Object.fromEntries(Object.entries(transaction.drops).map(([playerId, rosterId]) => [String(playerId), Number(rosterId)]))
      : {}
  };
}

export function deduplicateTransactions(transactions) {
  const byId = new Map();
  transactions.forEach(raw => {
    const transaction = normalizeTransaction(raw);
    if (!transaction.transactionId) return;
    const prior = byId.get(transaction.transactionId);
    if (!prior || (transaction.effectiveAt || 0) > (prior.effectiveAt || 0)) {
      byId.set(transaction.transactionId, transaction);
    }
  });
  return [...byId.values()].sort((left, right) => (
    (left.effectiveAt || Number.MAX_SAFE_INTEGER) - (right.effectiveAt || Number.MAX_SAFE_INTEGER) ||
    left.transactionId.localeCompare(right.transactionId)
  ));
}

function cloneRosters(anchorTeams) {
  return new Map(anchorTeams.map(team => [
    Number(team.rosterId),
    new Set((team.players || []).map(String))
  ]));
}

function ownersForPlayer(rosters, playerId) {
  return [...rosters.entries()]
    .filter(([, players]) => players.has(playerId))
    .map(([rosterId]) => rosterId);
}

export function reconstructRostersAtCutoff({
  anchorTeams,
  transactions,
  anchorAt,
  cutoffAt
}) {
  if (!(Number.isFinite(anchorAt) && Number.isFinite(cutoffAt) && anchorAt <= cutoffAt)) {
    throw new Error('anchorAt and cutoffAt must be finite timestamps with anchorAt <= cutoffAt');
  }

  const rosters = cloneRosters(anchorTeams);
  const audit = {
    considered: 0,
    applied: 0,
    ignoredIncomplete: 0,
    ignoredBeforeAnchor: 0,
    ignoredAfterCutoff: 0,
    missingTimestamp: 0,
    createdTimestampFallbacks: 0,
    missingDrops: [],
    implicitTransfers: [],
    unknownDestinationRosters: []
  };
  const appliedTransactions = [];

  deduplicateTransactions(transactions).forEach(transaction => {
    audit.considered += 1;
    if (transaction.status !== 'complete') {
      audit.ignoredIncomplete += 1;
      return;
    }
    if (!Number.isFinite(transaction.effectiveAt)) {
      audit.missingTimestamp += 1;
      return;
    }
    if (transaction.effectiveAtSource === 'created_fallback') audit.createdTimestampFallbacks += 1;
    if (transaction.effectiveAt <= anchorAt) {
      audit.ignoredBeforeAnchor += 1;
      return;
    }
    if (transaction.effectiveAt > cutoffAt) {
      audit.ignoredAfterCutoff += 1;
      return;
    }

    Object.entries(transaction.drops).forEach(([playerId, rosterId]) => {
      const players = rosters.get(rosterId);
      if (!players?.delete(playerId)) {
        audit.missingDrops.push({ transactionId: transaction.transactionId, playerId, rosterId });
      }
    });

    Object.entries(transaction.adds).forEach(([playerId, rosterId]) => {
      if (!rosters.has(rosterId)) {
        audit.unknownDestinationRosters.push({ transactionId: transaction.transactionId, playerId, rosterId });
        return;
      }
      const priorOwners = ownersForPlayer(rosters, playerId).filter(owner => owner !== rosterId);
      priorOwners.forEach(owner => rosters.get(owner).delete(playerId));
      if (priorOwners.length) {
        audit.implicitTransfers.push({
          transactionId: transaction.transactionId,
          playerId,
          fromRosterIds: priorOwners,
          toRosterId: rosterId
        });
      }
      rosters.get(rosterId).add(playerId);
    });

    audit.applied += 1;
    appliedTransactions.push(transaction);
  });

  const duplicatePlayers = [];
  const allPlayers = new Set([...rosters.values()].flatMap(players => [...players]));
  allPlayers.forEach(playerId => {
    const rosterIds = ownersForPlayer(rosters, playerId);
    if (rosterIds.length > 1) duplicatePlayers.push({ playerId, rosterIds });
  });

  return {
    rosters: Object.fromEntries(
      [...rosters.entries()]
        .sort(([left], [right]) => left - right)
        .map(([rosterId, players]) => [rosterId, [...players].sort()])
    ),
    appliedTransactions,
    audit: { ...audit, duplicatePlayers }
  };
}

function zonedParts(epochMs, timeZone) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(epochMs))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );
  return values;
}

export function zonedDateTimeToEpochMs(parts, timeZone = 'America/New_York') {
  const desiredAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0
  );
  let result = desiredAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(result, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const correction = desiredAsUtc - actualAsUtc;
    result += correction;
    if (correction === 0) break;
  }
  return result;
}

function addCalendarDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * DAY_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

export function weeklyRosterWindow(scheduleRows, {
  season,
  week,
  timeZone = 'America/New_York',
  gameEndBufferHours = 6,
  reportHour = 9
}) {
  const games = scheduleRows.filter(row => (
    Number(row.season) === Number(season) &&
    Number(row.week) === Number(week) &&
    String(row.game_type || row.gameType) === 'REG'
  ));
  if (!games.length) throw new Error(`No regular-season schedule rows for ${season} Week ${week}`);

  const kickoffs = games.map(game => {
    const [year, month, day] = String(game.gameday).split('-').map(Number);
    const [hour, minute] = String(game.gametime || '13:00').split(':').map(Number);
    return zonedDateTimeToEpochMs({ year, month, day, hour, minute }, timeZone);
  });
  const latestKickoff = Math.max(...kickoffs);
  const latestLocal = zonedParts(latestKickoff, timeZone);
  const reportDate = addCalendarDays(latestLocal, 1);
  const cutoffAt = zonedDateTimeToEpochMs({ ...reportDate, hour: reportHour }, timeZone);
  const anchorAt = latestKickoff + gameEndBufferHours * 60 * 60 * 1000;

  if (anchorAt > cutoffAt) {
    throw new Error(`Estimated game-end anchor is after report cutoff for ${season} Week ${week}`);
  }
  return { latestKickoff, anchorAt, cutoffAt };
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else value += character;
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  const [headers, ...data] = rows;
  return data.filter(values => values.some(Boolean)).map(values => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ''])
  ));
}
