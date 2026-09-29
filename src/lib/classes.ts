import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { decrypt } from "./crypto";
import { sendGymWhatsapp } from "./whatsapp";
import { expireInvoice } from "./gateway";

/** Registrations that hold a seat: confirmed ones, plus pending ones so a seat can't be sold twice mid-payment. */
export const SEAT_HOLDING_STATUSES = ["PENDING_PAYMENT", "CONFIRMED"] as const;

export function effectiveCapacity(session: { capacity: number | null }, cls: { capacity: number | null }): number | null {
  return session.capacity ?? cls.capacity;
}

/** A small client shape both the tenant client and a transaction client satisfy. */
type Counter = { classRegistration: { count(args: { where: Prisma.ClassRegistrationWhereInput }): Promise<number> } };

export function countSeatsTaken(db: Counter, sessionId: string): Promise<number> {
  return db.classRegistration.count({ where: { sessionId, status: { in: [...SEAT_HOLDING_STATUSES] } } });
}

export function whenLabel(startsAt: Date, timezone: string): string {
  return startsAt.toLocaleString("id-ID", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Tells the member their spot is confirmed. Runs as the system client (WhatsApp helper), so callers
 * must already have checked the registration belongs to the gym. Never throws.
 */
export async function sendClassConfirmation(registrationId: string): Promise<void> {
  try {
    const reg = await prisma.classRegistration.findUnique({
      where: { id: registrationId },
      include: { member: true, session: { include: { class: true, gym: true } } },
    });
    if (!reg || reg.member.anonymizedAt) return;
    const { session } = reg;
    await sendGymWhatsapp(reg.gymId, {
      to: decrypt(reg.member.phoneWhatsapp),
      message: `Hi ${reg.member.fullName}, you're booked for ${session.class.name} at ${session.gym.name} on ${whenLabel(session.startsAt, session.gym.timezone)}${session.class.instructor ? ` with ${session.class.instructor}` : ""}. See you there!`,
      type: "class_confirmation",
      memberId: reg.memberId,
    });
  } catch (err) {
    console.error("Class confirmation message failed", err);
  }
}

/** Tells everyone booked on a session that it was cancelled. Never throws. */
export async function sendClassCancellations(sessionId: string): Promise<void> {
  try {
    const session = await prisma.classSession.findUnique({
      where: { id: sessionId },
      include: { class: true, gym: true, registrations: { include: { member: true, payment: true } } },
    });
    if (!session) return;
    for (const reg of session.registrations) {
      if (reg.member.anonymizedAt) continue;
      await sendGymWhatsapp(session.gymId, {
        to: decrypt(reg.member.phoneWhatsapp),
        message: `Hi ${reg.member.fullName}, ${session.class.name} at ${session.gym.name} on ${whenLabel(session.startsAt, session.gym.timezone)} has been cancelled. ${reg.payment?.status === "PAID" ? "Please talk to the front desk about your payment." : "Sorry for the inconvenience."}`,
        type: "class_cancelled",
        memberId: reg.memberId,
      });
    }
  } catch (err) {
    console.error("Class cancellation messages failed", err);
  }
}

/** Best effort: stop an unpaid online invoice for a registration from being paid later. */
export async function expireRegistrationInvoice(payment: { externalInvoiceId: string | null; provider: string; status: string } | null | undefined): Promise<void> {
  if (!payment || payment.status !== "PENDING" || !payment.externalInvoiceId || payment.provider === "CASH") return;
  await expireInvoice(payment.externalInvoiceId, payment.provider).catch(() => undefined);
}
