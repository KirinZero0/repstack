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

export type Channel = "whatsapp" | "email";
export type ChannelStatus = "SENT" | "FAILED" | "SKIPPED";
/** What happened on each channel that was tried. */
export type NotifyResult = Partial<Record<Channel, ChannelStatus>>;

/** Why a message the person chose to send did not go, in words for the screen; null when it was sent. */
export function channelProblem(result: NotifyResult, channel: Channel): string | null {
  const status = result[channel];
  if (status === "SENT") return null;
  if (channel === "email") {
    return status === "FAILED"
      ? "The email couldn't be sent. Check the address and try again."
      : "Email isn't set up on Liftmora yet, so nothing was sent.";
  }
  return status === "FAILED"
    ? "WhatsApp couldn't send. Check the number and try again."
    : "WhatsApp isn't available: it's switched off in Settings, or no sending number is set up.";
}

/**
 * Per-gym channel switches live in Gym.settings. Email is how the system messages members and is on unless
 * turned off. WhatsApp is only ever sent when someone clicks a send button; this switch lets a gym turn
 * those off too.
 */
export function notificationChannels(settings: unknown): { whatsapp: boolean; email: boolean } {
  const s = (settings ?? {}) as { notifyWhatsapp?: unknown; notifyEmail?: unknown };
  return { whatsapp: s.notifyWhatsapp !== false, email: s.notifyEmail !== false };
}

/** Emails one person on the gym's behalf using the gym's templates, and logs the attempt. */
async function emailOne(
  gymId: string,
  gym: { name: string; address: string | null; settings: unknown },
  opts: { to: string; name: string; message: string; type: NotificationType; memberId?: string },
): Promise<ChannelStatus> {
  let status: "SENT" | "FAILED" | "SKIPPED";
  if (!emailConfigured()) {
    status = "SKIPPED";
  } else {
    const rows = await prisma.emailTemplate.findMany({ where: { OR: [{ gymId }, { gymId: null }] } });
    const { subject, text, html } = renderEmail(rows, gymId, opts.type, {
      gymName: gym.name,
      memberName: opts.name,
      gymAddress: gym.address ?? "",
      message: opts.message,
    });
    const replyTo = (gym.settings as { emailReplyTo?: unknown } | null)?.emailReplyTo;
    const result = await sendEmail({
      to: opts.to,
      subject,
      text,
      html,
      replyTo: typeof replyTo === "string" && replyTo ? replyTo : undefined,
    });
    status = result.ok ? "SENT" : "FAILED";
  }
  await prisma.notificationLog.create({
    data: { gymId, memberId: opts.memberId ?? null, type: opts.type, channel: "email", status },
  });
  return status;
}

async function emailMember(
  gymId: string,
  gym: { name: string; address: string | null; settings: unknown },
  opts: { message: string; type: NotificationType; memberId: string },
): Promise<ChannelStatus> {
  const member = await prisma.member.findUnique({ where: { id: opts.memberId }, select: { email: true, fullName: true, anonymizedAt: true } });
  if (!member || member.anonymizedAt) return "SKIPPED";
  return emailOne(gymId, gym, { ...opts, to: member.email, name: member.fullName });
}

/**
 * A test gym (Gym.isTest) sends nothing on its own: an automatic message is logged as skipped and goes nowhere.
 * Send buttons (manual) still work there, so the people trying it out can still reach themselves.
 */
async function skipForTestGym(gymId: string, type: NotificationType | SystemEmailType, memberId: string | null): Promise<NotifyResult> {
  await prisma.notificationLog
    .create({ data: { gymId, memberId, type, channel: "email", status: "SKIPPED" } })
    .catch((err) => console.error("Test gym skip log failed", err));
  return { email: "SKIPPED" };
}

/**
 * Tells a member something. By default (`auto`) that is an email, if the gym has email on. When someone
 * clicked a send button (`trigger: "manual"`) they pick the channel: `channel` sends on that one only, WhatsApp
 * (if the gym allows it) or email (even if the gym turned automatic email off); without `channel` a manual
 * send goes on both. `to` is the member's WhatsApp number; the email address comes from the member record.
 * Every attempt is logged per channel, and the result says what happened on each.
 */
export async function notifyMember(
  gymId: string,
  opts: { to: string; message: string; type: NotificationType; memberId: string; trigger?: Trigger; channel?: Channel },
): Promise<NotifyResult> {
  const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { name: true, address: true, settings: true, isTest: true } });
  if (!gym) return {};
  const allowed = notificationChannels(gym.settings);
  const manual = opts.trigger === "manual";
  if (gym.isTest && !manual) return skipForTestGym(gymId, opts.type, opts.memberId);
  const wantWhatsapp = manual && allowed.whatsapp && (opts.channel ? opts.channel === "whatsapp" : true);
  const wantEmail = opts.channel && manual ? opts.channel === "email" : allowed.email;

  const result: NotifyResult = {};
  await Promise.all([
    wantWhatsapp
      ? sendGymWhatsapp(gymId, opts).then((r) => {
          result.whatsapp = r.ok ? "SENT" : r.skipped ? "SKIPPED" : "FAILED";
        })
      : undefined,
    wantEmail
      ? emailMember(gymId, gym, opts).then((status) => {
          result.email = status;
        })
      : undefined,
  ]);
  // A WhatsApp the person asked for but the gym has switched off is reported, not silently dropped.
  if (manual && opts.channel === "whatsapp" && !allowed.whatsapp) result.whatsapp = "SKIPPED";
  return result;
}

/**
 * Tells a guest (class ticket or day pass) something. Guests aren't members: the WhatsApp number and the
 * optional email come from their request. Without `channel` (approve or decline) it goes over WhatsApp, which
 * is what the guest signed up with, if the gym allows it, and also by email when they left one and the gym
 * has email on. With `channel` (staff resending a ticket) it goes on that one only. Logged per channel with
 * no member.
 */
export async function notifyGuest(
  gymId: string,
  opts: { phone: string; email: string | null; name: string; message: string; type: NotificationType; channel?: Channel; trigger?: Trigger },
): Promise<NotifyResult> {
  const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { name: true, address: true, settings: true, isTest: true } });
  if (!gym) return {};
  const allowed = notificationChannels(gym.settings);
  // Staff clicking approve, decline or resend is manual (the default here); an automatic "we got your request" is email only.
  const auto = opts.trigger === "auto";
  if (gym.isTest && auto) return skipForTestGym(gymId, opts.type, null);
  const wantWhatsapp = !auto && Boolean(opts.phone) && (opts.channel ? opts.channel === "whatsapp" : allowed.whatsapp);
  const wantEmail = Boolean(opts.email) && (opts.channel ? opts.channel === "email" : allowed.email);

  const result: NotifyResult = {};
  await Promise.all([
    wantWhatsapp && allowed.whatsapp
      ? sendGymWhatsapp(gymId, { to: opts.phone, message: opts.message, type: opts.type }).then((r) => {
          result.whatsapp = r.ok ? "SENT" : r.skipped ? "SKIPPED" : "FAILED";
        })
      : undefined,
    wantEmail
      ? emailOne(gymId, gym, { to: opts.email!, name: opts.name, message: opts.message, type: opts.type }).then((status) => {
          result.email = status;
        })
      : undefined,
  ]);
  // A WhatsApp staff asked for but the gym has switched off is reported, not silently dropped.
  if (opts.channel === "whatsapp" && !allowed.whatsapp) result.whatsapp = "SKIPPED";
  return result;
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
  /** With a manual send, the one channel the person picked. */
  channel?: Channel;
}): Promise<NotifyResult> {
  const result: NotifyResult = {};
  const log = (channel: Channel, status: ChannelStatus) => {
    result[channel] = status;
    return prisma.notificationLog
      .create({ data: { gymId: opts.gymId, type: opts.type, channel, status } })
      .catch((err) => console.error("System message log failed", err));
  };
  const manual = opts.trigger === "manual";
  if (!manual) {
    const gym = await prisma.gym.findUnique({ where: { id: opts.gymId }, select: { isTest: true } });
    if (gym?.isTest) return skipForTestGym(opts.gymId, opts.type, null);
  }

  const sends: Promise<unknown>[] = [];
  if (opts.to.phone && manual && (!opts.channel || opts.channel === "whatsapp")) {
    sends.push(
      sendPlatformWhatsapp({ to: opts.to.phone, message: opts.message })
        .then((r) => log("whatsapp", r.ok ? "SENT" : r.skipped ? "SKIPPED" : "FAILED"))
        .catch((err) => {
          console.error("System WhatsApp failed", err);
          return log("whatsapp", "FAILED");
        }),
    );
  }
  if (opts.to.email && (!manual || !opts.channel || opts.channel === "email")) {
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
  return result;
}
