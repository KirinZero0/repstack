import { prisma } from "./prisma";
import { sendGymWhatsapp } from "./whatsapp";
import { emailConfigured, sendEmail } from "./email";

/** Per-gym channel switches live in Gym.settings. WhatsApp stays on unless turned off; email is opt-in. */
export function notificationChannels(settings: unknown): { whatsapp: boolean; email: boolean } {
  const s = (settings ?? {}) as { notifyWhatsapp?: unknown; notifyEmail?: unknown };
  return { whatsapp: s.notifyWhatsapp !== false, email: s.notifyEmail === true };
}

const SUBJECTS: Record<string, string> = {
  member_activation: "Activate your account",
  member_welcome: "Welcome",
  payment_receipt: "Payment received",
  expiry_reminder: "Your membership is expiring soon",
  expired_notice: "Your membership has expired",
  password_reset: "Reset your password",
  qr_fallback: "Your check-in QR link",
  class_confirmation: "Your class booking",
  class_cancelled: "A class was cancelled",
};

function subjectFor(gymName: string, type: string): string {
  const title = SUBJECTS[type] ?? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return `${gymName}: ${title}`;
}

async function emailMember(gymId: string, gymName: string, opts: { message: string; type: string; memberId: string }) {
  const member = await prisma.member.findUnique({ where: { id: opts.memberId }, select: { email: true, anonymizedAt: true } });
  if (!member || member.anonymizedAt) return;

  let status: "SENT" | "FAILED" | "SKIPPED";
  if (!emailConfigured()) {
    status = "SKIPPED";
  } else {
    const result = await sendEmail({ to: member.email, subject: subjectFor(gymName, opts.type), text: opts.message, fromName: gymName });
    status = result.ok ? "SENT" : "FAILED";
  }
  await prisma.notificationLog.create({
    data: { gymId, memberId: opts.memberId, type: opts.type, channel: "email", status },
  });
}

/**
 * Tells a member something, on whichever channels the gym has switched on. `to` is the member's
 * WhatsApp number; the email address is looked up from the member record. Every attempt is logged
 * per channel. With both channels off nothing is sent — the owner can still hand over links by hand.
 */
export async function notifyMember(
  gymId: string,
  opts: { to: string; message: string; type: string; memberId: string },
): Promise<void> {
  const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { name: true, settings: true } });
  if (!gym) return;
  const channels = notificationChannels(gym.settings);

  const sends: Promise<unknown>[] = [];
  if (channels.whatsapp) sends.push(sendGymWhatsapp(gymId, opts));
  if (channels.email) sends.push(emailMember(gymId, gym.name, opts));
  await Promise.all(sends);
}
