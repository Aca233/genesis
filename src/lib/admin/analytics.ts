export type PeriodComparison = { current: number; previous: number; delta: number; changeRate: number | null };

export function comparePeriods(current: number, previous: number): PeriodComparison {
  return { current, previous, delta: current - previous, changeRate: previous === 0 ? null : (current - previous) / previous };
}

export function percentile(values: number[], rank: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * Math.min(1, Math.max(0, rank))) - 1)];
}

export function buildDailySeries(rows: Array<{ occurredAt: Date; value: number }>, now = new Date(), days = 30) {
  const dateKey = (date: Date) => date.toISOString().slice(0, 10);
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(dateKey(row.occurredAt), (totals.get(dateKey(row.occurredAt)) ?? 0) + row.value);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (days - index - 1));
    const key = dateKey(date);
    return { date: key, value: totals.get(key) ?? 0 };
  });
}

export type AdminErrorEvent = { kind: string; error: string; userId: string | null; worldId: string | null; occurredAt: Date };

function errorFingerprint(error: string) {
  return error.toLowerCase()
    .replace(/\b[a-f0-9]{16,}\b/gi, "#")
    .replace(/\b\d+(?:\.\d+)?(?:ms|s|kb|mb|gb)?\b/gi, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function clusterAdminErrors(events: AdminErrorEvent[], now = new Date()) {
  const clusters = new Map<string, { kind: string; fingerprint: string; sample: string; occurrences: number; users: Set<string>; worlds: Set<string>; firstSeenAt: Date; lastSeenAt: Date }>();
  for (const event of events) {
    const fingerprint = errorFingerprint(event.error);
    const key = event.kind + ":" + fingerprint;
    const item = clusters.get(key) ?? { kind: event.kind, fingerprint, sample: event.error, occurrences: 0, users: new Set<string>(), worlds: new Set<string>(), firstSeenAt: event.occurredAt, lastSeenAt: event.occurredAt };
    item.occurrences += 1;
    if (event.userId) item.users.add(event.userId);
    if (event.worldId) item.worlds.add(event.worldId);
    if (event.occurredAt < item.firstSeenAt) item.firstSeenAt = event.occurredAt;
    if (event.occurredAt > item.lastSeenAt) item.lastSeenAt = event.occurredAt;
    clusters.set(key, item);
  }
  return Array.from(clusters.values()).map((item) => ({
    kind: item.kind,
    fingerprint: item.fingerprint,
    sample: item.sample,
    occurrences: item.occurrences,
    affectedUsers: item.users.size,
    affectedWorlds: item.worlds.size,
    firstSeenAt: item.firstSeenAt,
    lastSeenAt: item.lastSeenAt,
    active: now.getTime() - item.lastSeenAt.getTime() <= 24 * 60 * 60 * 1000,
  })).sort((a, b) => b.occurrences - a.occurrences || b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}
