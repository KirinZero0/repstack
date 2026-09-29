/** The wall-clock parts of `date` as observed in `timezone`, as a UTC-based ms value (for offset arithmetic). */
function wallClockAsUtcMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/**
 * Turns a local wall-clock time ("YYYY-MM-DDTHH:mm", as a datetime-local input gives it) in
 * `timezone` into the actual instant. Two passes handle a DST offset change around the time.
 */
export function zonedTimeToUtc(local: string, timezone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) throw new Error("Expected YYYY-MM-DDTHH:mm");
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    const offset = wallClockAsUtcMs(new Date(guess), timezone) - guess;
    guess = naive - offset;
  }
  return new Date(guess);
}

/** Returns a YYYY-MM-DD key for `date` as observed in `timezone` — used for "same calendar day" checks. */
export function dayKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
