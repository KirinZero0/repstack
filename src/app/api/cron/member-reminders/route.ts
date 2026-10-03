import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { notifyMember } from "@/lib/notify";
import { decrypt } from "@/lib/crypto";

const REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const reminderCutoff = new Date(now.getTime() + REMINDER_WINDOW_MS);

  const expiringSoon = await prisma.member.findMany({
    where: {
      status: "ACTIVE",
      membershipExpiry: { gte: now, lte: reminderCutoff },
    },
  });

  let remindersSent = 0;
  for (const member of expiringSoon) {
    await notifyMember(member.gymId, {
      to: decrypt(member.phoneWhatsapp),
      message: `Hi ${member.fullName}, your gym membership expires on ${member.membershipExpiry?.toLocaleDateString(
        "id-ID",
      )}. Renew soon to keep your access active.`,
      type: "expiry_reminder",
      memberId: member.id,
    });
    remindersSent++;
  }

  const expired = await prisma.member.findMany({
    where: { status: "ACTIVE", membershipExpiry: { lt: now } },
  });

  for (const member of expired) {
    await prisma.member.update({ where: { id: member.id }, data: { status: "EXPIRED" } });
    await notifyMember(member.gymId, {
      to: decrypt(member.phoneWhatsapp),
      message: `Hi ${member.fullName}, your gym membership has expired. Renew to regain access.`,
      type: "expired_notice",
      memberId: member.id,
    });
  }

  return NextResponse.json({ remindersSent, membersExpired: expired.length });
}
