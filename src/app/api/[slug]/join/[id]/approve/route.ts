import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { approveMemberSignup } from "@/lib/memberSignup";

/**
 * Staff confirms a manual bank-transfer request: a join request becomes an active member, a
 * renewal request extends the existing member. Either way a PAID (CASH) payment is recorded.
 */
export async function POST(_req: NextRequest, { params }: { params: { slug: string; id: string } }) {
  let session, gym;
  try {
    ({ session, gym } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }

  const member = await approveMemberSignup(gym, params.id, { recordedById: session.staffUserId });
  if (!member) {
    return NextResponse.json(
      { error: "Request not found, already handled, that email is already registered, or the member's account is cancelled" },
      { status: 409 },
    );
  }
  return NextResponse.json({ memberId: member.id });
}
