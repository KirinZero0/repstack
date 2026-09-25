import type { TenantDb } from "@/lib/prisma";
import { dayKeyInTimezone } from "@/lib/date";
import type { CheckInResult, Gym, Member } from "@prisma/client";

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
): Promise<{ result: CheckInResult; memberSummary?: { fullName: string; photoUrl: string | null } }> {
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

  const todayKey = dayKeyInTimezone(new Date(), gym.timezone);
  const todaysCheckins = await db.checkIn.findMany({
    where: { memberId: member.id, result: "SUCCESS" },
    orderBy: { checkedInAt: "desc" },
    take: 5,
  });
  const alreadyCheckedInToday = todaysCheckins.some(
    (c) => dayKeyInTimezone(c.checkedInAt, gym.timezone) === todayKey,
  );
  if (alreadyCheckedInToday) {
    await logAttempt(db, { gymId: gym.id, memberId: member.id, staffUserId, result: "DUPLICATE" });
    return { result: "DUPLICATE" };
  }

  await logAttempt(db, { gymId: gym.id, memberId: member.id, staffUserId, result: "SUCCESS" });
  return { result: "SUCCESS", memberSummary: { fullName: member.fullName, photoUrl: member.photoUrl } };
}
