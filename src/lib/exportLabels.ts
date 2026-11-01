/** "2026-11-01" as "1 Nov 2026", for the lines at the top of an export. */
export function exportDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "Made 1 Nov 2026, 14:05 (Asia/Jakarta)": when the file was produced, on the gym's clock. */
export function exportStamp(timezone: string, now = new Date()): string {
  const when = now.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone });
  return `Made ${when} (${timezone})`;
}
