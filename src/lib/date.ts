/** Returns a YYYY-MM-DD key for `date` as observed in `timezone` — used for "same calendar day" checks. */
export function dayKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
