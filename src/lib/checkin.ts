import { prisma } from "@/lib/prisma";
import { dayKeyInTimezone } from "@/lib/date";
import type { CheckInResult, Gym, Member } from "@prisma/client";

async function logAttempt(params: {
  gymId: string;
  memberId: string;
  staffUserId: string | null;
  result: CheckInResult;
}) {
  await prisma.checkIn.create({
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
  member: Member,
  gym: Gym,
  staffUserId: string | null,
): Promise<{ result: CheckInResult; memberSummary?: { fullName: string; photoUrl: string | null } }> {
  if (member.status === "FROZEN") {
    await logAttempt({ gymId: gym.id, memberId: member.id, staffUserId, result: "FROZEN" });
    return { result: "FROZEN" };
  }

  if (
    member.status === "EXPIRED" ||
    member.status === "PENDING_PAYMENT" ||
    member.status === "CANCELLED" ||
    !member.membershipExpiry ||
    member.membershipExpiry < new Date()
  ) {
    await logAttempt({ gymId: gym.id, memberId: member.id, staffUserId, result: "EXPIRED" });
    return { result: "EXPIRED" };
  }

  const todayKey = dayKeyInTimezone(new Date(), gym.timezone);
  const todaysCheckins = await prisma.checkIn.findMany({
    where: { memberId: member.id, result: "SUCCESS" },
    orderBy: { checkedInAt: "desc" },
    take: 5,
  });
  const alreadyCheckedInToday = todaysCheckins.some(
    (c) => dayKeyInTimezone(c.checkedInAt, gym.timezone) === todayKey,
  );
  if (alreadyCheckedInToday) {
    await logAttempt({ gymId: gym.id, memberId: member.id, staffUserId, result: "DUPLICATE" });
    return { result: "DUPLICATE" };
  }

  await logAttempt({ gymId: gym.id, memberId: member.id, staffUserId, result: "SUCCESS" });
  return { result: "SUCCESS", memberSummary: { fullName: member.fullName, photoUrl: member.photoUrl } };
}
