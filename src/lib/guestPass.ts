import { prisma } from "./prisma";
import { decrypt } from "./crypto";
import { buildTicketToken } from "./qr";
import { notificationChannels } from "./notify";
import { sendGymWhatsapp } from "./whatsapp";
import { whenLabel } from "./classes";
import { dayKeyInTimezone } from "./date";

/** Max requests one IP can file per hour, and max one gym can receive per hour (public form, no login). */
export const MAX_GUEST_REQUESTS_PER_IP_HOUR = 6;
export const MAX_GUEST_REQUESTS_PER_GYM_HOUR = 60;

/** A ticket scans from this long before the session starts until the session ends. */
export const TICKET_OPENS_BEFORE_MS = 60 * 60 * 1000;

export function ticketUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return `${base}/ticket/${token}`;
}

export function ticketTokenFor(pass: { id: string; gymId: string; ticketSecret: string }): string {
  return buildTicketToken({ gymId: pass.gymId, passId: pass.id }, pass.ticketSecret);
}

/** Whether a ticket can be scanned right now for a session: not early, not over. */
export function ticketWindow(session: { startsAt: Date }, durationMinutes: number, now = Date.now()): "EARLY" | "OPEN" | "OVER" {
  const start = session.startsAt.getTime();
  if (now < start - TICKET_OPENS_BEFORE_MS) return "EARLY";
  if (now > start + durationMinutes * 60 * 1000) return "OVER";
  return "OPEN";
}

/** The parts of a pass that say what it is for. */
type PassTarget = {
  session: { startsAt: Date; status: string; class: { name: string; durationMinutes: number } } | null;
  dayPassPlan: { name: string } | null;
  visitDate: string | null;
};

/** "Yoga" or "Day pass (Single visit)": what the guest is getting in. */
export function passTitle(pass: PassTarget): string {
  return pass.session ? pass.session.class.name : `Day pass${pass.dayPassPlan ? ` (${pass.dayPassPlan.name})` : ""}`;
}

/** When it is for: the class start time, or the visit day. */
export function passWhen(pass: PassTarget, timezone: string): string {
  if (pass.session) return whenLabel(pass.session.startsAt, timezone);
  if (!pass.visitDate) return "";
  // Noon UTC keeps the calendar day the same in every timezone when formatting.
  return new Date(`${pass.visitDate}T12:00:00Z`).toLocaleDateString("id-ID", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
}

/** Whether the ticket can be used right now, and if not whether it is too early or too late. */
export function passWindow(pass: PassTarget, timezone: string, now = Date.now()): "EARLY" | "OPEN" | "OVER" {
  if (pass.session) return ticketWindow(pass.session, pass.session.class.durationMinutes, now);
  const today = dayKeyInTimezone(new Date(now), timezone);
  if (!pass.visitDate || today > pass.visitDate) return "OVER";
  return today < pass.visitDate ? "EARLY" : "OPEN";
}

/** A class pass needs a live session; a day pass only needs to be for today or later. */
export function passIsCancelled(pass: PassTarget): boolean {
  return pass.session ? pass.session.status !== "SCHEDULED" : false;
}

const PASS_INCLUDE = { gym: true, session: { include: { class: true } }, dayPassPlan: true } as const;

/**
 * WhatsApps the guest their ticket link. Runs as the system client, so callers must already have
 * checked the pass belongs to the gym. Honours the gym's WhatsApp switch. Never throws.
 */
export async function sendGuestTicket(passId: string): Promise<void> {
  try {
    const pass = await prisma.guestPass.findUnique({ where: { id: passId }, include: PASS_INCLUDE });
    if (!pass || pass.status !== "APPROVED") return;
    const { gym } = pass;
    if (!notificationChannels(gym.settings).whatsapp) return;
    await sendGymWhatsapp(pass.gymId, {
      to: decrypt(pass.phoneWhatsapp),
      message: `Hi ${pass.fullName}, you're approved for ${passTitle(pass)} at ${gym.name} on ${passWhen(pass, gym.timezone)}. Show this one-time QR ticket at the front desk: ${ticketUrl(ticketTokenFor(pass))}`,
      type: "guest_ticket",
    });
  } catch (err) {
    console.error("Guest ticket message failed", err);
  }
}

/** Tells the guest their request was declined. Never throws. */
export async function sendGuestRejection(passId: string): Promise<void> {
  try {
    const pass = await prisma.guestPass.findUnique({ where: { id: passId }, include: PASS_INCLUDE });
    if (!pass || pass.status !== "REJECTED") return;
    const { gym } = pass;
    if (!notificationChannels(gym.settings).whatsapp) return;
    await sendGymWhatsapp(pass.gymId, {
      to: decrypt(pass.phoneWhatsapp),
      message: `Hi ${pass.fullName}, sorry — we couldn't confirm your spot for ${passTitle(pass)} on ${passWhen(pass, gym.timezone)}. Please contact the front desk.`,
      type: "guest_rejected",
    });
  } catch (err) {
    console.error("Guest rejection message failed", err);
  }
}
