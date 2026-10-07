import type { TenantDb } from "@/lib/prisma";
import { dayKeyInTimezone } from "@/lib/date";
import type { CheckInResult, Gym, Member } from "@prisma/client";

export const MAX_CHECKINS_PER_DAY = 10;

export interface CheckinRules {
  /** How many successful check-ins a member can have per calendar day (gym timezone). */
  perDay: number;
  /** Minimum minutes between two check-ins, so an accidental double scan doesn't use one up. Only matters when perDay > 1. */
  gapMinutes: number;
}

/** The gym's check-in rules. The default is the original one: a single check-in per day. */
export function checkinRules(settings: unknown): CheckinRules {
  const s = (settings ?? {}) as { checkinsPerDay?: unknown; checkinGapMinutes?: unknown };
  const perDay = typeof s.checkinsPerDay === "number" && Number.isInteger(s.checkinsPerDay) && s.checkinsPerDay >= 1 && s.checkinsPerDay <= MAX_CHECKINS_PER_DAY ? s.checkinsPerDay : 1;
  const gap = typeof s.checkinGapMinutes === "number" && Number.isInteger(s.checkinGapMinutes) && s.checkinGapMinutes >= 0 && s.checkinGapMinutes <= 240 ? s.checkinGapMinutes : 0;
  return { perDay, gapMinutes: perDay > 1 ? gap : 0 };
}

async function logAttempt(db: TenantDb, params: {
  gymId: string;
  memberId: string;
  staffUserId: string | null;
  result: CheckInResult;
}) {
  await db.checkIn.create({
    data: {
      gymId: params.gymId,
      memberId: params.memberId,
      staffUserId: params.staffUserId,
      result: params.result,
    },
  });
}

/**
 * Shared status/expiry/duplicate evaluation for a member who has already been identified and
 * whose QR (member-held or station) has already been verified as belonging to this gym. Used
 * by both the staff-scans-member flow and the member-scans-station flow so the check-in rules
 * (and what gets logged) can't drift between them.
 */
export async function evaluateAndLogCheckin(
  db: TenantDb,
  member: Member,
  gym: Gym,
  staffUserId: string | null,
): Promise<{ result: CheckInResult; message?: string; memberSummary?: { fullName: string; photoUrl: string | null } }> {
  if (member.status === "FROZEN") {
    await logAttempt(db, { gymId: gym.id, memberId: member.id, staffUserId, result: "FROZEN" });
    return { result: "FROZEN" };
  }

  if (
    member.status === "EXPIRED" ||
    member.status === "PENDING_PAYMENT" ||
    member.status === "CANCELLED" ||
    !member.membershipExpiry ||
    member.membershipExpiry < new Date()
  ) {
    await logAttempt(db, { gymId: gym.id, memberId: member.id, staffUserId, result: "EXPIRED" });
    return { result: "EXPIRED" };
  }

  const rules = checkinRules(gym.settings);
  const now = new Date();
  const todayKey = dayKeyInTimezone(now, gym.timezone);
  const recent = await db.checkIn.findMany({
    where: { memberId: member.id, result: "SUCCESS" },
    orderBy: { checkedInAt: "desc" },
    take: MAX_CHECKINS_PER_DAY + 5,
  });
  const today = recent.filter((c) => dayKeyInTimezone(c.checkedInAt, gym.timezone) === todayKey);

  if (today.length >= rules.perDay) {
    await logAttempt(db, { gymId: gym.id, memberId: member.id, staffUserId, result: "DUPLICATE" });
    return {
      result: "DUPLICATE",
      message: rules.perDay === 1 ? "Already checked in today" : `Daily limit reached (${rules.perDay} check-ins)`,
    };
  }
  // Too soon after the last one: most likely the same visit scanned twice, so it doesn't count.
  if (rules.gapMinutes > 0 && recent[0] && now.getTime() - recent[0].checkedInAt.getTime() < rules.gapMinutes * 60_000) {
    await logAttempt(db, { gymId: gym.id, memberId: member.id, staffUserId, result: "DUPLICATE" });
    return { result: "DUPLICATE", message: "Already checked in a moment ago" };
  }

  await logAttempt(db, { gymId: gym.id, memberId: member.id, staffUserId, result: "SUCCESS" });
  return { result: "SUCCESS", memberSummary: { fullName: member.fullName, photoUrl: member.photoUrl } };
}
