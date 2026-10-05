import type { TenantDb } from "./prisma";

export const DEFAULT_OCCUPANCY_WINDOW_HOURS = 3;

/**
 * Nobody scans out of a gym reliably, so "in the gym" is: checked in successfully within the last
 * N hours and not checked out since. N is the gym's own setting; three hours covers a long session
 * without keeping the morning crowd on the board all day.
 */
export function occupancyWindowHours(settings: unknown): number {
  const v = (settings as { occupancyWindowHours?: unknown } | null)?.occupancyWindowHours;
  return typeof v === "number" && v >= 1 && v <= 12 ? v : DEFAULT_OCCUPANCY_WINDOW_HOURS;
}

export interface Present {
  checkInId: string;
  memberId: string;
  fullName: string;
  photoUrl: string | null;
  since: Date;
}

/** Who is in the gym right now, most recent arrival first. One entry per member. */
export async function getOccupancy(db: TenantDb, gymId: string, settings: unknown, now = new Date()): Promise<Present[]> {
  const since = new Date(now.getTime() - occupancyWindowHours(settings) * 60 * 60 * 1000);
  const rows = await db.checkIn.findMany({
    where: { gymId, result: "SUCCESS", checkedOutAt: null, checkedInAt: { gte: since } },
    orderBy: { checkedInAt: "desc" },
    include: { member: { select: { fullName: true, photoUrl: true, anonymizedAt: true } } },
  });
  const seen = new Set<string>();
  const present: Present[] = [];
  for (const r of rows) {
    if (seen.has(r.memberId) || r.member.anonymizedAt) continue;
    seen.add(r.memberId);
    present.push({ checkInId: r.id, memberId: r.memberId, fullName: r.member.fullName, photoUrl: r.member.photoUrl, since: r.checkedInAt });
  }
  return present;
}

/**
 * Ends the member's visit: every open check-in of theirs inside the window is closed, since a
 * member who scanned twice (a DUPLICATE is logged, but a second SUCCESS can land across midnight)
 * is still one person leaving once. Returns how many rows were closed; 0 means they weren't in.
 */
export async function checkOutMember(db: TenantDb, gymId: string, memberId: string, settings: unknown, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - occupancyWindowHours(settings) * 60 * 60 * 1000);
  const { count } = await db.checkIn.updateMany({
    where: { gymId, memberId, result: "SUCCESS", checkedOutAt: null, checkedInAt: { gte: since } },
    data: { checkedOutAt: now },
  });
  return count;
}

/** The member's own open check-in, if they're currently counted as in the gym. */
export async function findOpenCheckIn(db: TenantDb, gymId: string, memberId: string, settings: unknown, now = new Date()) {
  const since = new Date(now.getTime() - occupancyWindowHours(settings) * 60 * 60 * 1000);
  return db.checkIn.findFirst({
    where: { gymId, memberId, result: "SUCCESS", checkedOutAt: null, checkedInAt: { gte: since } },
    orderBy: { checkedInAt: "desc" },
  });
}
