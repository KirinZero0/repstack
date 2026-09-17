import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseQrToken, verifyQrToken } from "@/lib/qr";
import { dayKeyInTimezone } from "@/lib/date";
import type { CheckInResult } from "@prisma/client";

const checkinSchema = z.object({ token: z.string().min(1) });

type ResultCode = CheckInResult | "GYM_SUSPENDED" | "UNAUTHENTICATED" | "MALFORMED";

async function logAttempt(params: {
  gymId: string;
  memberId: string | null;
  staffUserId: string | null;
  result: CheckInResult;
}) {
  if (!params.memberId) return; // CheckIn.memberId is required — nothing to attribute a malformed scan to.
  await prisma.checkIn.create({
    data: {
      gymId: params.gymId,
      memberId: params.memberId,
      staffUserId: params.staffUserId,
      result: params.result,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.kind !== "staff") {
    return NextResponse.json({ result: "UNAUTHENTICATED" as ResultCode }, { status: 401 });
  }

  const gym = await prisma.gym.findUnique({ where: { id: session.gymId } });
  if (!gym) {
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

  const member = await prisma.member.findUnique({ where: { id: unverifiedPayload.memberId } });
  if (!member || member.gymId !== session.gymId) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  const verified = verifyQrToken(parsed.data.token, member.qrSecret);
  if (!verified) {
    await logAttempt({ gymId: gym.id, memberId: member.id, staffUserId: session.staffUserId, result: "INVALID" });
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  if (member.status === "FROZEN") {
    await logAttempt({ gymId: gym.id, memberId: member.id, staffUserId: session.staffUserId, result: "FROZEN" });
    return NextResponse.json({ result: "FROZEN" as ResultCode }, { status: 200 });
  }

  if (
    member.status === "EXPIRED" ||
    member.status === "PENDING_PAYMENT" ||
    member.status === "CANCELLED" ||
    !member.membershipExpiry ||
    member.membershipExpiry < new Date()
  ) {
    await logAttempt({ gymId: gym.id, memberId: member.id, staffUserId: session.staffUserId, result: "EXPIRED" });
    return NextResponse.json({ result: "EXPIRED" as ResultCode }, { status: 200 });
  }

  const todayKey = dayKeyInTimezone(new Date(), gym.timezone);
  const todaysCheckins = await prisma.checkIn.findMany({
    where: { memberId: member.id, result: "SUCCESS" },
    orderBy: { checkedInAt: "desc" },
    take: 5,
  });
  const alreadyCheckedInToday = todaysCheckins.some(
    (c) => dayKeyInTimezone(c.checkedInAt, gym.timezone) === todayKey,
  );
  if (alreadyCheckedInToday) {
    await logAttempt({ gymId: gym.id, memberId: member.id, staffUserId: session.staffUserId, result: "DUPLICATE" });
    return NextResponse.json({ result: "DUPLICATE" as ResultCode }, { status: 200 });
  }

  await logAttempt({ gymId: gym.id, memberId: member.id, staffUserId: session.staffUserId, result: "SUCCESS" });
  return NextResponse.json({
    result: "SUCCESS" as ResultCode,
    member: { fullName: member.fullName, photoUrl: member.photoUrl },
  });
}
