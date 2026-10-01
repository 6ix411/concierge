/**
 * A small in-memory rate limiter. It is per server instance, so it's a first line of defence
 * against runaway clients rather than a hard quota.
 */

const windows = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (windows.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 10_000) {
    for (const [entry, times] of windows)
      if (times.every((time) => now - time >= windowMs)) windows.delete(entry);
  }
  return true;
}
