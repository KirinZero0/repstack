const DAY_MS = 24 * 60 * 60 * 1000;

/** New expiry after paying for `days`: adds to the time left, or starts from `paidAt` if already lapsed. */
export function extendedExpiry(current: Date | null, days: number, paidAt: Date): Date {
  const base = current && current > paidAt ? current : paidAt;
  return new Date(base.getTime() + days * DAY_MS);
}
