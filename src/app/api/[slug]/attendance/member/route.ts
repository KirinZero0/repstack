import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { manualCheckinSchema } from "@/lib/validation/tenant";
import { evaluateAndLogCheckin } from "@/lib/checkin";

/** Owner or staff checks a member in by hand. Same status, expiry and daily-limit rules as a QR scan. */
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

  const parsed = manualCheckinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Tenant isolation: the member must belong to the session's gym.
  const member = await db.member.findUnique({ where: { id: parsed.data.memberId } });
  if (!member || member.gymId !== gym.id) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const outcome = await evaluateAndLogCheckin(db, member, gym, session.staffUserId);
  return NextResponse.json({ result: outcome.result, message: outcome.message, member: outcome.memberSummary });
}
