import type { NotificationType, SystemEmailType } from "@/config/email";
import { prisma } from "./prisma";
import { sendGymWhatsapp, sendPlatformWhatsapp } from "./whatsapp";
import { emailConfigured, sendEmail } from "./email";
import { renderEmail } from "./emailTemplates";

/**
 * Who started a message. `auto` is the system on its own (a member was added, a payment arrived, a
 * reminder is due): those go by email only. `manual` is someone clicking a send button (remind, send the
 * QR link, send a password link): those also go over WhatsApp.
 */
export type Trigger = "auto" | "manual";

/**
 * Per-gym channel switches live in Gym.settings. Email is how the system messages members and is on unless
 * turned off. WhatsApp is only ever sent when someone clicks a send button; this switch lets a gym turn
 * those off too.
 */
export function notificationChannels(settings: unknown): { whatsapp: boolean; email: boolean } {
  const s = (settings ?? {}) as { notifyWhatsapp?: unknown; notifyEmail?: unknown };
  return { whatsapp: s.notifyWhatsapp !== false, email: s.notifyEmail !== false };
}

async function emailMember(
  gymId: string,
  gym: { name: string; address: string | null; settings: unknown },
  opts: { message: string; type: NotificationType; memberId: string },
) {
  const member = await prisma.member.findUnique({ where: { id: opts.memberId }, select: { email: true, fullName: true, anonymizedAt: true } });
  if (!member || member.anonymizedAt) return;

  let status: "SENT" | "FAILED" | "SKIPPED";
  if (!emailConfigured()) {
    status = "SKIPPED";
  } else {
    const rows = await prisma.emailTemplate.findMany({ where: { OR: [{ gymId }, { gymId: null }] } });
    const { subject, text, html } = renderEmail(rows, gymId, opts.type, {
      gymName: gym.name,
      memberName: member.fullName,
      gymAddress: gym.address ?? "",
      message: opts.message,
    });
    const replyTo = (gym.settings as { emailReplyTo?: unknown } | null)?.emailReplyTo;
    const result = await sendEmail({
      to: member.email,
      subject,
      text,
      html,
      replyTo: typeof replyTo === "string" && replyTo ? replyTo : undefined,
    });
    status = result.ok ? "SENT" : "FAILED";
  }
  await prisma.notificationLog.create({
    data: { gymId, memberId: opts.memberId, type: opts.type, channel: "email", status },
  });
}

/**
 * Tells a member something. Email goes out whenever the gym has it on; WhatsApp only when `trigger` is
 * "manual" (someone clicked a send button) and the gym allows it. `to` is the member's WhatsApp number; the
 * email address is looked up from the member record. Every attempt is logged per channel. With both
 * channels off nothing is sent: the owner can still hand over links by hand.
 */
export async function notifyMember(
  gymId: string,
  opts: { to: string; message: string; type: NotificationType; memberId: string; trigger?: Trigger },
): Promise<void> {
  const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { name: true, address: true, settings: true } });
  if (!gym) return;
  const channels = notificationChannels(gym.settings);

  const sends: Promise<unknown>[] = [];
  if (channels.whatsapp && opts.trigger === "manual") sends.push(sendGymWhatsapp(gymId, opts));
  if (channels.email) sends.push(emailMember(gymId, gym, opts));
  await Promise.all(sends);
}

/**
 * Liftmora's own message to a gym's owner or staff (welcome, billing, access): by email, and also over WhatsApp
 * when `trigger` is "manual" (a person clicked a send button). Unlike member messages these aren't the gym's
 * to switch off, because they cover billing and security. The wording is the platform's (see SYSTEM_EMAIL_TYPES). Every
 * attempt is logged against the gym. Never throws.
 */
export async function notifyOwner(opts: {
  gymId: string;
  gymName: string;
  gymAddress?: string | null;
  to: { name: string; email?: string | null; phone?: string | null };
  message: string;
  type: SystemEmailType;
  trigger?: Trigger;
}): Promise<void> {
  const log = (channel: "whatsapp" | "email", status: "SENT" | "FAILED" | "SKIPPED") =>
    prisma.notificationLog
      .create({ data: { gymId: opts.gymId, type: opts.type, channel, status } })
      .catch((err) => console.error("System message log failed", err));

  const sends: Promise<unknown>[] = [];
  if (opts.to.phone && opts.trigger === "manual") {
    sends.push(
      sendPlatformWhatsapp({ to: opts.to.phone, message: opts.message })
        .then((r) => log("whatsapp", r.ok ? "SENT" : r.skipped ? "SKIPPED" : "FAILED"))
        .catch((err) => {
          console.error("System WhatsApp failed", err);
          return log("whatsapp", "FAILED");
        }),
    );
  }
  if (opts.to.email) {
    const email = opts.to.email;
    sends.push(
      (async () => {
        if (!emailConfigured()) return log("email", "SKIPPED");
        const rows = await prisma.emailTemplate.findMany({ where: { gymId: null, type: opts.type } });
        const { subject, text, html } = renderEmail(rows, null, opts.type, {
          gymName: opts.gymName,
          gymAddress: opts.gymAddress ?? "",
          memberName: opts.to.name,
          recipientName: opts.to.name,
          message: opts.message,
        });
        const result = await sendEmail({ to: email, subject, text, html });
        return log("email", result.ok ? "SENT" : "FAILED");
      })().catch((err) => {
        console.error("System email failed", err);
        return log("email", "FAILED");
      }),
    );
  }
  await Promise.all(sends);
}
