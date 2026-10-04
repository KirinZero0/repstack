import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { addMemberSchema } from "@/lib/validation/tenant";
import { extendedExpiry } from "@/lib/membership";
import { countMemberSeats, memberLimitMessage } from "@/lib/limits";
import { createMember, isUniqueViolation } from "@/lib/members";

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
  let created;
  try {
    created = await createMember(
      db,
      gym,
      { fullName: data.fullName, email: data.email, phoneWhatsapp: data.phoneWhatsapp, planId: plan.id, membershipExpiry, status: "ACTIVE" },
      { recordPayment: { recordedById: session.staffUserId, amount: plan.price, currency: plan.currency }, notify: true },
    );
  } catch (err) {
    // The tenant-scoped lookup above can't see another gym's member with this email; the unique index can.
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "Unable to add member with this email" }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ memberId: created.memberId, membershipExpiry: membershipExpiry.toISOString() }, { status: 201 });
}
