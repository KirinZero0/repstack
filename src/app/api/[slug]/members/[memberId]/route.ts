import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { MemberStatus } from "@prisma/client";
import { requireTenantSession, SessionError } from "@/lib/session";
import { tenantOrResponse } from "@/lib/routeAuth";
import { prisma } from "@/lib/prisma";
import { deleteBlob } from "@/lib/blob";
import { memberActionSchema } from "@/lib/validation/tenant";
import { encrypt, hmacLookup, normalizePhone } from "@/lib/crypto";
import { countMemberSeats, memberLimitMessage } from "@/lib/limits";

/** The status a member returns to once their membership period is running again. */
function statusForExpiry(expiry: Date | null, now: Date): MemberStatus {
  if (!expiry) return "PENDING_PAYMENT";
  return expiry > now ? "ACTIVE" : "EXPIRED";
}

/**
 * Front-desk actions on one member: freeze, unfreeze, edit details (owner or staff), and cancel or
 * reactivate (owner only). Freezing stops the clock: the frozen time is added back to the expiry on unfreeze.
 */
export async function PATCH(req: NextRequest, { params }: { params: { slug: string; memberId: string } }) {
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

  const parsed = memberActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const action = parsed.data;

  if ((action.action === "cancel" || action.action === "reactivate") && session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can cancel or reactivate a membership" }, { status: 403 });
  }

  // Tenant isolation: the member must belong to the session's gym.
  const member = await db.member.findUnique({ where: { id: params.memberId } });
  if (!member || member.gymId !== gym.id) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (member.anonymizedAt) return NextResponse.json({ error: "This member's data was erased and can't be changed." }, { status: 409 });

  const now = new Date();

  switch (action.action) {
    case "freeze": {
      if (member.status !== "ACTIVE") return NextResponse.json({ error: "Only active members can be frozen." }, { status: 409 });
      await db.member.update({ where: { id: member.id }, data: { status: "FROZEN", frozenAt: now } });
      return NextResponse.json({ ok: true, status: "FROZEN" });
    }

    case "unfreeze": {
      if (member.status !== "FROZEN") return NextResponse.json({ error: "This member isn't frozen." }, { status: 409 });
      const frozenMs = member.frozenAt ? Math.max(0, now.getTime() - member.frozenAt.getTime()) : 0;
      const expiry = member.membershipExpiry ? new Date(member.membershipExpiry.getTime() + frozenMs) : null;
      const status = statusForExpiry(expiry, now);
      await db.member.update({ where: { id: member.id }, data: { status, membershipExpiry: expiry, frozenAt: null } });
      return NextResponse.json({ ok: true, status });
    }

    case "cancel": {
      if (member.status === "CANCELLED") return NextResponse.json({ error: "Already cancelled." }, { status: 409 });
      // A new qrSecret makes every QR this member already holds worthless.
      await db.member.update({
        where: { id: member.id },
        data: { status: "CANCELLED", frozenAt: null, qrSecret: crypto.randomUUID() },
      });
      return NextResponse.json({ ok: true, status: "CANCELLED" });
    }

    case "reactivate": {
      if (member.status !== "CANCELLED") return NextResponse.json({ error: "Only cancelled memberships can be reactivated." }, { status: 409 });
      const saasPlan = await db.saasPlan.findUnique({ where: { id: gym.saasPlanId } });
      if (saasPlan && (await countMemberSeats(db, gym.id)) >= saasPlan.maxMembers) {
        return NextResponse.json({ error: memberLimitMessage(saasPlan.name, saasPlan.maxMembers) }, { status: 403 });
      }
      const status = statusForExpiry(member.membershipExpiry, now);
      await db.member.update({ where: { id: member.id }, data: { status } });
      return NextResponse.json({ ok: true, status });
    }

    case "edit": {
      const data: Record<string, unknown> = {};
      if (action.fullName !== undefined) data.fullName = action.fullName;

      if (action.email !== undefined && action.email !== member.email) {
        // Member.email is unique across every gym, so keep the message generic.
        if (await db.member.findUnique({ where: { email: action.email } })) {
          return NextResponse.json({ error: "That email can't be used for this member.", field: "email" }, { status: 409 });
        }
        data.email = action.email;
      }

      if (action.phone !== undefined) {
        data.phoneWhatsapp = encrypt(action.phone);
        data.phoneWhatsappLookup = hmacLookup(normalizePhone(action.phone));
      }

      if (action.planId !== undefined && action.planId !== member.planId) {
        const plan = await db.membershipPlan.findUnique({ where: { id: action.planId } });
        if (!plan || plan.gymId !== gym.id || !plan.isActive) {
          return NextResponse.json({ error: "That plan isn't available.", field: "planId" }, { status: 400 });
        }
        data.planId = plan.id;
      }

      if (Object.keys(data).length === 0) return NextResponse.json({ ok: true, status: member.status });
      await db.member.update({ where: { id: member.id }, data });
      return NextResponse.json({ ok: true, status: member.status });
    }
  }
}

/**
 * Owner deletes a member who was added by mistake (typo, duplicate): gone for good, and the email is
 * free to use again. Only possible while the member has no history. Anyone with a payment, a visit or a
 * class booking is part of the books, so they can be cancelled or erased (kept, but anonymised) instead.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; memberId: string } }) {
  const auth = await tenantOrResponse(params.slug, { ownerOnly: "Only the owner can delete a member" });
  if ("response" in auth) return auth.response;
  const { gym, db } = auth.ctx;

  // Tenant isolation: the member must belong to the session's gym.
  const member = await db.member.findUnique({ where: { id: params.memberId } });
  if (!member || member.gymId !== gym.id) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const [payments, checkIns, bookings] = await Promise.all([
    db.payment.count({ where: { memberId: member.id } }),
    db.checkIn.count({ where: { memberId: member.id } }),
    db.classRegistration.count({ where: { memberId: member.id } }),
  ]);
  if (payments + checkIns + bookings > 0) {
    return NextResponse.json(
      { error: "This member has payments, visits or class bookings, so they can't be deleted. Cancel the membership, or erase their data, instead." },
      { status: 409 },
    );
  }

  // Their sign-up request, activation and reset links live in tables the gym role can't touch.
  await prisma.$transaction([
    prisma.magicLink.deleteMany({ where: { memberId: member.id } }),
    prisma.passwordReset.deleteMany({ where: { kind: "member", subjectId: member.id } }),
    prisma.memberSignup.deleteMany({ where: { OR: [{ memberId: member.id }, { gymId: gym.id, email: member.email }] } }),
    prisma.member.delete({ where: { id: member.id } }),
  ]);
  if (member.photoUrl) await deleteBlob(member.photoUrl);
  return NextResponse.json({ ok: true });
}
