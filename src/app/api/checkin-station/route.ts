import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { verifyStationToken } from "@/lib/qr";
import { evaluateAndLogCheckin } from "@/lib/checkin";

const checkinSchema = z.object({ token: z.string().min(1) });

type ResultCode = "INVALID" | "GYM_SUSPENDED" | "UNAUTHENTICATED" | "MALFORMED" | "FROZEN" | "EXPIRED" | "DUPLICATE" | "SUCCESS";

/** Member scans their gym's printed/displayed station QR with their own phone to check themselves in. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.kind !== "member") {
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

  const stationGymId = verifyStationToken(parsed.data.token);
  if (!stationGymId) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  // Cross-tenant rejection: the scanned station must belong to the member's own gym — checked
  // before anything else, same as the staff-scan flow.
  if (stationGymId !== session.gymId) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  const member = await prisma.member.findUnique({ where: { id: session.memberId } });
  if (!member || member.gymId !== session.gymId) {
    return NextResponse.json({ result: "INVALID" as ResultCode }, { status: 200 });
  }

  const outcome = await evaluateAndLogCheckin(member, gym, null);
  return NextResponse.json({ result: outcome.result as ResultCode, member: outcome.memberSummary });
}
