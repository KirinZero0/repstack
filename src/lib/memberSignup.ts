import crypto from "crypto";
import { prisma, tenantTransaction } from "./prisma";
import { decrypt } from "./crypto";
import { extendedExpiry } from "./membership";
import { sendGymWhatsapp } from "./whatsapp";
import { paymentProviderEnum } from "./gateway";

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
        termsAcceptedAt: signup.termsAcceptedAt,
      },
    });
    await tx.payment.create({
      data: {
        gymId: signup.gymId,
        memberId: member.id,
        planId: signup.planId,
        provider: paymentProviderEnum(),
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
    message: `Welcome to ${signup.gym.name}, ${signup.fullName}! Your ${signup.plan.name} membership is active until ${expiry.toLocaleDateString("id-ID", { timeZone: signup.gym.timezone })}. Log in with ${signup.email} at ${process.env.NEXT_PUBLIC_APP_URL}/${signup.gym.slug}/login to see your check-in QR.`,
    type: "member_welcome",
    memberId: member.id,
  }).catch((err) => console.error("Member welcome message failed", err));
}

/**
 * Staff confirmed a manual bank-transfer request: turns it into a real, active Member plus its
 * PAID (CASH) Payment, atomically, scoped to this gym by RLS. Returns null if the request wasn't
 * found, wasn't awaiting review, or its email got taken by someone else in the meantime (flagged
 * as a CONFLICT for manual follow-up, same as the online flow).
 */
export async function approveMemberSignup(gym: { id: string; name: string; slug: string; timezone: string }, signupId: string) {
  const created = await tenantTransaction(gym.id, async (tx) => {
    const signup = await tx.memberSignup.findUnique({ where: { id: signupId }, include: { plan: true } });
    if (!signup || signup.gymId !== gym.id || signup.status !== "PENDING_REVIEW") return null;

    const taken = await tx.member.findUnique({ where: { email: signup.email } });
    if (taken) {
      await tx.memberSignup.update({ where: { id: signup.id }, data: { status: "CONFLICT" } });
      return null;
    }

    const paidAt = new Date();
    const expiry = extendedExpiry(null, signup.plan.durationDays, paidAt);

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
        termsAcceptedAt: signup.termsAcceptedAt,
      },
    });
    await tx.payment.create({
      data: {
        gymId: signup.gymId,
        memberId: member.id,
        planId: signup.planId,
        provider: "CASH", // confirmed by staff from a bank-transfer proof, not an online gateway
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
    return { member, signup, expiry };
  });

  if (!created) return null;

  await sendGymWhatsapp(gym.id, {
    to: decrypt(created.signup.phoneWhatsapp),
    message: `Welcome to ${gym.name}, ${created.signup.fullName}! Your membership is active until ${created.expiry.toLocaleDateString("id-ID", { timeZone: gym.timezone })}. Log in with ${created.signup.email} at ${process.env.NEXT_PUBLIC_APP_URL}/${gym.slug}/login to see your check-in QR.`,
    type: "member_welcome",
    memberId: created.member.id,
  }).catch((err) => console.error("Member welcome message failed", err));

  return created.member;
}

/** Staff couldn't confirm the transfer. Doesn't create a Member; the requester sees this on their status page. */
export async function rejectMemberSignup(gym: { id: string }, signupId: string) {
  return tenantTransaction(gym.id, async (tx) => {
    const signup = await tx.memberSignup.findUnique({ where: { id: signupId } });
    if (!signup || signup.gymId !== gym.id || signup.status !== "PENDING_REVIEW") return null;
    return tx.memberSignup.update({ where: { id: signup.id }, data: { status: "REJECTED" } });
  });
}
