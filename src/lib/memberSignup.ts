import crypto from "crypto";
import { prisma } from "./prisma";
import { decrypt } from "./crypto";
import { extendedExpiry } from "./membership";
import { sendGymWhatsapp } from "./whatsapp";

export const MEMBER_SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;
/** Max signups one IP can start per hour, and max one gym can receive per hour. */
export const MAX_SIGNUPS_PER_IP_HOUR = 5;
export const MAX_SIGNUPS_PER_GYM_HOUR = 60;

/** Keyed hash so we can throttle by IP without storing IP addresses. */
export function hashIp(ip: string): string {
  const key = process.env.LOOKUP_HMAC_KEY;
  if (!key) throw new Error("LOOKUP_HMAC_KEY env var not set");
  return crypto.createHmac("sha256", key).update(`ip:${ip}`).digest("hex");
}

export function gymAcceptsSignups(settings: unknown): boolean {
  return (settings as { acceptSignups?: unknown } | null)?.acceptSignups === true;
}

/**
 * Turns a paid join request into a real, active Member plus its PAID Payment, atomically.
 * Safe to call twice: anything but a PENDING signup is ignored.
 */
export async function completeMemberSignup(signupId: string, paidAt: Date) {
  const signup = await prisma.memberSignup.findUnique({ where: { id: signupId }, include: { plan: true, gym: true } });
  if (!signup || signup.status !== "PENDING") return;

  // Someone (or a staff member) may have taken this email while the invoice was open.
  const taken = await prisma.member.findUnique({ where: { email: signup.email } });
  if (taken) {
    await prisma.memberSignup.update({ where: { id: signup.id }, data: { status: "CONFLICT" } });
    console.error(`Member signup ${signup.id} was paid but its email is already registered; needs manual follow-up`);
    return;
  }

  const expiry = extendedExpiry(null, signup.plan.durationDays, paidAt);

  const member = await prisma.$transaction(async (tx) => {
    const member = await tx.member.create({
      data: {
        gymId: signup.gymId,
        planId: signup.planId,
        fullName: signup.fullName,
        email: signup.email,
        phoneWhatsapp: signup.phoneWhatsapp,
        phoneWhatsappLookup: signup.phoneWhatsappLookup,
        passwordHash: signup.passwordHash,
        status: "ACTIVE",
        membershipExpiry: expiry,
      },
    });
    await tx.payment.create({
      data: {
        gymId: signup.gymId,
        memberId: member.id,
        planId: signup.planId,
        provider: "XENDIT",
        externalInvoiceId: signup.externalInvoiceId,
        amount: signup.amount,
        currency: signup.plan.currency,
        status: "PAID",
        paidAt,
      },
    });
    await tx.memberSignup.update({
      where: { id: signup.id },
      data: { status: "COMPLETED", memberId: member.id, completedAt: new Date() },
    });
    return member;
  });

  await sendGymWhatsapp(signup.gymId, {
    to: decrypt(signup.phoneWhatsapp),
    message: `Welcome to ${signup.gym.name}, ${signup.fullName}! Your ${signup.plan.name} membership is active until ${expiry.toLocaleDateString("id-ID", { timeZone: signup.gym.timezone })}. Log in with ${signup.email} at ${process.env.NEXT_PUBLIC_APP_URL}/g/${signup.gym.slug}/member-login to see your check-in QR.`,
    type: "member_welcome",
    memberId: member.id,
  }).catch((err) => console.error("Member welcome message failed", err));
}
