import type { TenantDb } from "./prisma";
import { dayKeyInTimezone } from "./date";

/** "Sari Dewi Lestari" → "Sari L." Members see each other on the board, so surnames stay private. */
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Member";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export interface BoardRow {
  memberId: string;
  /** Short form for members' eyes. */
  name: string;
  /** Full name for staff screens. */
  fullName: string;
  value: number;
}

export interface Leaderboard {
  /** Distinct days visited this calendar month, most first. Everyone with at least one visit. */
  visits: BoardRow[];
  /** Consecutive days visited ending today or yesterday, longest first. Everyone with a streak of 2+. */
  streaks: BoardRow[];
}

/**
 * Who shows up most. Built from successful check-ins over the last 120 days (enough for any streak
 * worth bragging about), one visit per member per calendar day in the gym's timezone. Erased and
 * cancelled members are left out.
 */
export async function getLeaderboard(db: TenantDb, gymId: string, timezone: string, now = new Date()): Promise<Leaderboard> {
  const since = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
  const checkins = await db.checkIn.findMany({
    where: { gymId, result: "SUCCESS", checkedInAt: { gte: since }, member: { anonymizedAt: null, status: { not: "CANCELLED" } } },
    select: { memberId: true, checkedInAt: true, member: { select: { fullName: true } } },
  });

  const days = new Map<string, { fullName: string; days: Set<string> }>();
  for (const c of checkins) {
    const entry = days.get(c.memberId) ?? { fullName: c.member.fullName, days: new Set<string>() };
    entry.days.add(dayKeyInTimezone(c.checkedInAt, timezone));
    days.set(c.memberId, entry);
  }

  const todayKey = dayKeyInTimezone(now, timezone);
  const monthKey = todayKey.slice(0, 7);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const visits: BoardRow[] = [];
  const streaks: BoardRow[] = [];
  for (const [memberId, { fullName, days: visited }] of Array.from(days.entries())) {
    const thisMonth = Array.from(visited).filter((d) => d.startsWith(monthKey)).length;
    if (thisMonth > 0) visits.push({ memberId, name: displayName(fullName), fullName, value: thisMonth });

    // A streak is alive if it reaches today, or yesterday (today isn't over yet).
    let cursor = visited.has(todayKey) ? new Date(now) : visited.has(dayKeyInTimezone(yesterday, timezone)) ? yesterday : null;
    let streak = 0;
    while (cursor && visited.has(dayKeyInTimezone(cursor, timezone))) {
      streak++;
      cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
    }
    if (streak >= 2) streaks.push({ memberId, name: displayName(fullName), fullName, value: streak });
  }

  const byValueThenName = (a: BoardRow, b: BoardRow) => b.value - a.value || a.fullName.localeCompare(b.fullName);
  return { visits: visits.sort(byValueThenName), streaks: streaks.sort(byValueThenName) };
}

/** 1-based position of a member on a sorted board, or null when they're not on it. */
export function rankOf(board: BoardRow[], memberId: string): number | null {
  const i = board.findIndex((r) => r.memberId === memberId);
  return i === -1 ? null : i + 1;
}
