import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tenantDb } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseQrToken, verifyQrToken } from "@/lib/qr";
import { evaluateAndLogCheckin } from "@/lib/checkin";

const checkinSchema = z.object({ token: z.string().min(1) });

type ResultCode = "INVALID" | "GYM_SUSPENDED" | "UNAUTHENTICATED" | "MALFORMED" | "FROZEN" | "EXPIRED" | "DUPLICATE" | "SUCCESS";

/** Staff scans a member's own QR code (camera scanner at the front desk). */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.kind !== "staff") {
    return NextResponse.json({ result: "UNAUTHENTICATED" as ResultCode }, { status: 401 });
  }

  const db = tenantDb(session.gymId);
  const [gym, staff] = await Promise.all([
    db.gym.findUnique({ where: { id: session.gymId } }),
    db.staffUser.findUnique({ where: { id: session.staffUserId }, select: { isActive: true, gymId: true } }),
  ]);
  if (!gym || !staff || !staff.isActive || staff.gymId !== gym.id) {
    return NextResponse.json({ result: "UNAUTHENTICATED" as ResultCode }, { status: 401 });
  }
  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
    return NextResponse.json({ result: "GYM_SUSPENDED" as ResultCode }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = checkinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ result: "MALFORMED" as ResultCode }, { status: 400 });
  }

  const unverifiedPayload = parseQrToken(parsed.data.token);
  if (!unverifiedPayload) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  // Cross-tenant rejection: the QR's embedded gymId must match the scanning staff's own gym,
  // checked BEFORE we trust anything else about the token.
  if (unverifiedPayload.gymId !== session.gymId) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  const member = await db.member.findUnique({ where: { id: unverifiedPayload.memberId } });
  if (!member || member.gymId !== session.gymId) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  const verified = verifyQrToken(parsed.data.token, member.qrSecret);
  if (!verified) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  const outcome = await evaluateAndLogCheckin(db, member, gym, session.staffUserId);
  return NextResponse.json({ result: outcome.result as ResultCode, message: outcome.message, member: outcome.memberSummary });
}
