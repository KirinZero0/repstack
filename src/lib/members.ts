import type { MemberStatus, Prisma } from "@prisma/client";
import type { TenantDb } from "./prisma";
import { encrypt, hmacLookup, normalizePhone } from "./crypto";
import { createMagicLink } from "./magicLink";
import { notifyMember } from "./notify";

export const ACTIVATION_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface NewMemberInput {
  fullName: string;
  email: string;
  phoneWhatsapp: string;
  planId: string;
  membershipExpiry: Date;
  status: MemberStatus;
}

export interface CreateMemberOptions {
  /**
   * Record a CASH payment of the plan's price, dated now. Right for "they just paid at the desk";
   * wrong for a member imported from the gym's old spreadsheet, who paid before Liftmora existed.
   */
  recordPayment: { recordedById: string; amount: Prisma.Decimal | number; currency: string } | null;
  /** Send the activation link on the gym's channels. Off lets an owner import quietly and hand links over later. */
  notify: boolean;
}

/**
 * The one way a member record comes into being from the back office: encrypted phone, lookup
 * hash, an activation link, and optionally a payment and the welcome message. Both "Add member"
 * and the CSV import go through here so they can't drift apart.
 */
export async function createMember(
  db: TenantDb,
  gym: { id: string; name: string; timezone: string },
  input: NewMemberInput,
  opts: CreateMemberOptions,
): Promise<{ memberId: string; activationUrl: string }> {
  const member = await db.member.create({
    data: {
      gymId: gym.id,
      planId: input.planId,
      fullName: input.fullName,
      email: input.email,
      phoneWhatsapp: encrypt(input.phoneWhatsapp),
      phoneWhatsappLookup: hmacLookup(normalizePhone(input.phoneWhatsapp)),
      status: input.status,
      membershipExpiry: input.membershipExpiry,
    },
  });

  if (opts.recordPayment) {
    await db.payment.create({
      data: {
        gymId: gym.id,
        memberId: member.id,
        planId: input.planId,
        provider: "CASH",
        amount: opts.recordPayment.amount,
        currency: opts.recordPayment.currency,
        status: "PAID",
        paidAt: new Date(),
        recordedById: opts.recordPayment.recordedById,
      },
    });
  }

  const { token } = await createMagicLink({
    memberId: member.id,
    purpose: "activate",
    expiresInMs: ACTIVATION_LINK_TTL_MS,
  });
  const activationUrl = `${process.env.NEXT_PUBLIC_APP_URL}/activate/${token}`;

  if (opts.notify) {
    const until = input.membershipExpiry.toLocaleDateString("id-ID", { timeZone: gym.timezone });
    await notifyMember(gym.id, {
      to: input.phoneWhatsapp,
      message: [
        `Hi ${input.fullName}! You've been added to ${gym.name}.`,
        input.status === "EXPIRED"
          ? `Your membership expired on ${until}. Renew at the front desk to check in again.`
          : `Your membership is active until ${until}.`,
        `Set your password and see your check-in QR here: ${activationUrl}`,
      ].join("\n"),
      type: "member_activation",
      memberId: member.id,
    });
  }

  return { memberId: member.id, activationUrl };
}

/** True for Prisma's unique-constraint error, which is how a duplicate email surfaces on create. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}
