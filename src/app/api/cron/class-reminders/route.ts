import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { notifyMember } from "@/lib/notify";
import { decrypt } from "@/lib/crypto";
import { whenLabel } from "@/lib/classes";

/** Sessions starting within this long get their reminders on the next run. Runs hourly (vercel.json). */
const CLASS_REMINDER_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * A WhatsApp nudge to everyone confirmed for a class that starts soon. Each booking is reminded at
 * most once: the row is stamped before the message is sent, so a slow run or a retry can't double up.
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
      session: { status: "SCHEDULED", startsAt: { gt: now, lte: new Date(now.getTime() + CLASS_REMINDER_WINDOW_MS) } },
    },
    include: { member: true, session: { include: { class: true, gym: true } } },
  });

  let remindersSent = 0;
  for (const reg of due) {
    if (reg.member.anonymizedAt) continue;
    // Claim it first; whoever flips the row from null sends the one message.
    const { count } = await prisma.classRegistration.updateMany({ where: { id: reg.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (count === 0) continue;
    const { session } = reg;
    await notifyMember(reg.gymId, {
      to: decrypt(reg.member.phoneWhatsapp),
      message: `Reminder: ${session.class.name} at ${session.gym.name} starts ${whenLabel(session.startsAt, session.gym.timezone)}${session.class.instructor ? ` with ${session.class.instructor}` : ""}. See you there!`,
      type: "class_reminder",
      memberId: reg.memberId,
    });
    remindersSent++;
  }

  return NextResponse.json({ remindersSent });
}
