import { prisma } from "./prisma";
import { decrypt } from "./crypto";
import { buildTicketToken } from "./qr";
import { notificationChannels } from "./notify";
import { sendGymWhatsapp } from "./whatsapp";
import { whenLabel } from "./classes";

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

/**
 * WhatsApps the guest their ticket link. Runs as the system client, so callers must already have
 * checked the pass belongs to the gym. Honours the gym's WhatsApp switch. Never throws.
 */
export async function sendGuestTicket(passId: string): Promise<void> {
  try {
    const pass = await prisma.guestPass.findUnique({
      where: { id: passId },
      include: { session: { include: { class: true, gym: true } } },
    });
    if (!pass || pass.status !== "APPROVED") return;
    const { gym, class: cls } = pass.session;
    if (!notificationChannels(gym.settings).whatsapp) return;
    await sendGymWhatsapp(pass.gymId, {
      to: decrypt(pass.phoneWhatsapp),
      message: `Hi ${pass.fullName}, you're approved for ${cls.name} at ${gym.name} on ${whenLabel(pass.session.startsAt, gym.timezone)}. Show this one-time QR ticket at the front desk: ${ticketUrl(ticketTokenFor(pass))}`,
      type: "guest_ticket",
    });
  } catch (err) {
    console.error("Guest ticket message failed", err);
  }
}

/** Tells the guest their request was declined. Never throws. */
export async function sendGuestRejection(passId: string): Promise<void> {
  try {
    const pass = await prisma.guestPass.findUnique({
      where: { id: passId },
      include: { session: { include: { class: true, gym: true } } },
    });
    if (!pass || pass.status !== "REJECTED") return;
    const { gym, class: cls } = pass.session;
    if (!notificationChannels(gym.settings).whatsapp) return;
    await sendGymWhatsapp(pass.gymId, {
      to: decrypt(pass.phoneWhatsapp),
      message: `Hi ${pass.fullName}, sorry — we couldn't confirm your spot in ${cls.name} on ${whenLabel(pass.session.startsAt, gym.timezone)}. Please contact the front desk.`,
      type: "guest_rejected",
    });
  } catch (err) {
    console.error("Guest rejection message failed", err);
  }
}
