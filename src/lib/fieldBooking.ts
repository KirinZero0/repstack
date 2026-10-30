import { zonedTimeToUtc, dayKeyInTimezone } from "./date";

/** Longest single booking, in minutes. */
export const MAX_BOOKING_MINUTES = 6 * 60;
/** How far ahead people can book, in days. */
export const MAX_DAYS_AHEAD = 60;
/** A booking's ticket works from this long before it starts. */
export const EARLY_SCAN_MINUTES = 30;

export interface FieldRules {
  /** Opening and closing time as minutes after midnight (closing may be 1440 = midnight). */
  opensAt: number;
  closesAt: number;
  /** Bookings start and end on multiples of this many minutes. */
  stepMinutes: number;
  pricePerHour: number;
}

export interface MinuteRange {
  start: number;
  end: number;
}

/** "07:30" for 450. */
export function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 450 for "07:30"; null when it isn't a time of day. "24:00" is allowed as the end of the day. */
export function parseClock(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[2]) < 60 && minutes <= 24 * 60 ? minutes : null;
}

/** Why a field's opening hours don't work, or null. Times must sit on the step so every booking can too. */
export function hoursProblem(opensAt: number, closesAt: number, step: number): string | null {
  if (closesAt <= opensAt) return "The field must close after it opens.";
  if (opensAt % step !== 0 || closesAt % step !== 0) return `Opening and closing times must be on the ${step}-minute mark.`;
  return null;
}

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** The real start and end instants of a booking on local date `dateKey` in the gym's timezone. */
export function bookingInstants(dateKey: string, startMin: number, endMin: number, timezone: string): { startsAt: Date; endsAt: Date } {
  const at = (m: number) => {
    // 24:00 is midnight at the end of the day, which zonedTimeToUtc can't take as HH:mm.
    const day = m >= 24 * 60 ? new Date(Date.parse(`${dateKey}T00:00:00Z`) + 24 * 3600 * 1000).toISOString().slice(0, 10) : dateKey;
    return zonedTimeToUtc(`${day}T${clock(m >= 24 * 60 ? 0 : m)}`, timezone);
  };
  return { startsAt: at(startMin), endsAt: at(endMin) };
}

/** Price for a stretch of time: the hourly price pro rata, in whole rupiah. */
export function bookingPrice(pricePerHour: number, minutes: number): number {
  return Math.round((pricePerHour * minutes) / 60);
}

/** Why a requested time can't be booked, in words for the form; null when the time itself is fine. */
/** Pass `now = null` for staff: they may log a booking that is already under way, and aren't held to the booking horizon. */
export function timeProblem(rules: FieldRules, dateKey: string, startMin: number, endMin: number, timezone: string, now: Date | null = new Date()): string | null {
  if (!isDateKey(dateKey)) return "Pick a date.";
  if (startMin % rules.stepMinutes !== 0 || endMin % rules.stepMinutes !== 0) return `Times must be on the ${rules.stepMinutes}-minute mark.`;
  if (endMin <= startMin) return "The end must be after the start.";
  if (startMin < rules.opensAt || endMin > rules.closesAt) return `This field is open ${clock(rules.opensAt)} to ${clock(rules.closesAt)}.`;
  if (endMin - startMin > MAX_BOOKING_MINUTES) return `A booking can be at most ${MAX_BOOKING_MINUTES / 60} hours.`;
  if (now === null) return null;
  const { startsAt } = bookingInstants(dateKey, startMin, endMin, timezone);
  if (startsAt.getTime() <= now.getTime()) return "That time has already started or passed.";
  if (startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 3600 * 1000) return `Bookings open ${MAX_DAYS_AHEAD} days ahead.`;
  return null;
}

/** The part of each booking that falls on local date `dateKey`, as minutes after local midnight. */
export function busyRanges(bookings: { startsAt: Date; endsAt: Date }[], dateKey: string, timezone: string): MinuteRange[] {
  const dayStart = zonedTimeToUtc(`${dateKey}T00:00`, timezone).getTime();
  const next = new Date(Date.parse(`${dateKey}T00:00:00Z`) + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const dayEnd = zonedTimeToUtc(`${next}T00:00`, timezone).getTime();
  const out: MinuteRange[] = [];
  for (const b of bookings) {
    const s = Math.max(b.startsAt.getTime(), dayStart);
    const e = Math.min(b.endsAt.getTime(), dayEnd);
    if (e > s) out.push({ start: Math.round((s - dayStart) / 60000), end: Math.round((e - dayStart) / 60000) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Stretches of the open day that no booking covers, as minutes after midnight. */
export function freeRanges(rules: FieldRules, busy: MinuteRange[]): MinuteRange[] {
  const free: MinuteRange[] = [];
  let cursor = rules.opensAt;
  for (const b of busy) {
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, rules.closesAt) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < rules.closesAt) free.push({ start: cursor, end: rules.closesAt });
  return free.filter((r) => r.end > r.start);
}

/** Whether [start, end) lies wholly inside one free stretch. */
export function fitsInFree(free: MinuteRange[], start: number, end: number): boolean {
  return free.some((r) => start >= r.start && end <= r.end);
}

/** When a booking's ticket can be scanned: from a little before it starts until it ends. */
export function bookingWindow(b: { startsAt: Date; endsAt: Date }, now = new Date()): "EARLY" | "OPEN" | "OVER" {
  if (now.getTime() >= b.endsAt.getTime()) return "OVER";
  if (now.getTime() < b.startsAt.getTime() - EARLY_SCAN_MINUTES * 60000) return "EARLY";
  return "OPEN";
}

/** "Sat 31 Oct, 18:00 to 19:30" in the gym's timezone. */
export function bookingWhen(b: { startsAt: Date; endsAt: Date }, timezone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" }).format(b.startsAt);
  const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day}, ${time(b.startsAt)} to ${time(b.endsAt)}`;
}

export { dayKeyInTimezone };
