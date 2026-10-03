import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { addMemberSchema } from "@/lib/validation/tenant";
import { encrypt, hmacLookup, normalizePhone } from "@/lib/crypto";
import { createMagicLink } from "@/lib/magicLink";
import { extendedExpiry } from "@/lib/membership";
import { notifyMember } from "@/lib/notify";
import { countMemberSeats, memberLimitMessage } from "@/lib/limits";

const ACTIVATION_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }

  const body = await req.json().catch(() => null);
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // Member.email is globally unique across all tenants (schema constraint), so this check is
  // inherently cross-tenant. Keep the error generic — don't confirm the email belongs to a
  // member at another gym specifically.
  const existingEmail = await db.member.findUnique({ where: { email: data.email } });
  if (existingEmail) {
    return NextResponse.json({ error: "Unable to add member with this email" }, { status: 409 });
  }

  const plan = await db.membershipPlan.findUnique({ where: { id: data.planId } });
  if (!plan || plan.gymId !== gym.id || !plan.isActive) {
    return NextResponse.json({ error: "Invalid membership plan" }, { status: 400 });
  }

  const saasPlan = await db.saasPlan.findUnique({ where: { id: gym.saasPlanId } });
  if (saasPlan && (await countMemberSeats(db, gym.id)) >= saasPlan.maxMembers) {
    return NextResponse.json({ error: memberLimitMessage(saasPlan.name, saasPlan.maxMembers) }, { status: 403 });
  }

  const now = new Date();
  // Staff can type a specific expiry (e.g. what was actually paid for); left blank, it's the
  // plan's standard duration starting today.
  const membershipExpiry = data.membershipExpiry
    ? new Date(`${data.membershipExpiry}T23:59:59Z`)
    : extendedExpiry(null, plan.durationDays, now);

  // No payment gateway is wired up yet: adding a member here is staff saying "this person paid",
  // so they're created active straight away, with a matching CASH payment for the records.
  const member = await db.member.create({
    data: {
      gymId: gym.id,
      planId: plan.id,
      fullName: data.fullName,
      email: data.email,
      phoneWhatsapp: encrypt(data.phoneWhatsapp),
      phoneWhatsappLookup: hmacLookup(normalizePhone(data.phoneWhatsapp)),
      status: "ACTIVE",
      membershipExpiry,
    },
  });

  await db.payment.create({
    data: {
      gymId: gym.id,
      memberId: member.id,
      planId: plan.id,
      provider: "CASH",
      amount: plan.price,
      currency: plan.currency,
      status: "PAID",
      paidAt: now,
      recordedById: session.staffUserId,
    },
  });

  const { token } = await createMagicLink({
    memberId: member.id,
    purpose: "activate",
    expiresInMs: ACTIVATION_LINK_TTL_MS,
  });
  const activationUrl = `${process.env.NEXT_PUBLIC_APP_URL}/activate/${token}`;

  await notifyMember(gym.id, {
    to: data.phoneWhatsapp,
    message: [
      `Hi ${data.fullName}! You've been added to ${gym.name}.`,
      `Your membership is active until ${membershipExpiry.toLocaleDateString("id-ID", { timeZone: gym.timezone })}.`,
      `Set your password and see your check-in QR here: ${activationUrl}`,
    ].join("\n"),
    type: "member_activation",
    memberId: member.id,
  });

  return NextResponse.json({ memberId: member.id, membershipExpiry: membershipExpiry.toISOString() }, { status: 201 });
}
