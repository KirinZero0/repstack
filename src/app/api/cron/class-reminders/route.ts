import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { notifyMember } from "@/lib/notify";
import { decrypt } from "@/lib/crypto";
import { whenLabel } from "@/lib/classes";
import { dayKeyInTimezone } from "@/lib/date";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A WhatsApp nudge to everyone confirmed for a class that runs tomorrow. It runs once a day in the evening
 * (vercel.json, 11:00 UTC = 18:00 in Jakarta), which fits a free hosting plan that only allows daily crons.
 * "Tomorrow" is the calendar day in each gym's own timezone. Each booking is reminded at most once: the row
 * is stamped before the message is sent, so a slow run or a retry can't double up.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await prisma.classRegistration.findMany({
    where: {
      status: "CONFIRMED",
      reminderSentAt: null,
      // Two days ahead covers "tomorrow" in any timezone; the exact day is checked per gym below.
      session: { status: "SCHEDULED", startsAt: { gt: now, lte: new Date(now.getTime() + 2 * DAY_MS) } },
    },
    include: { member: true, session: { include: { class: true, gym: true } } },
  });

  let remindersSent = 0;
  for (const reg of due) {
    if (reg.member.anonymizedAt) continue;
    const tz = reg.session.gym.timezone;
    if (dayKeyInTimezone(reg.session.startsAt, tz) !== dayKeyInTimezone(new Date(now.getTime() + DAY_MS), tz)) continue;
    // Claim it first; whoever flips the row from null sends the one message.
    const { count } = await prisma.classRegistration.updateMany({ where: { id: reg.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (count === 0) continue;
    const { session } = reg;
    await notifyMember(reg.gymId, {
      to: decrypt(reg.member.phoneWhatsapp),
      message: `Reminder: ${session.class.name} at ${session.gym.name} is tomorrow, ${whenLabel(session.startsAt, session.gym.timezone)}${session.class.instructor ? ` with ${session.class.instructor}` : ""}. See you there!`,
      type: "class_reminder",
      memberId: reg.memberId,
    });
    remindersSent++;
  }

  return NextResponse.json({ remindersSent });
}
