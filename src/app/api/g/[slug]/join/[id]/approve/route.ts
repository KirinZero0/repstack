import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { approveMemberSignup } from "@/lib/memberSignup";

/** Staff confirms a manual bank-transfer request: activates the member and records a PAID (CASH) payment. */
export async function POST(_req: NextRequest, { params }: { params: { slug: string; id: string } }) {
  let gym;
  try {
    ({ gym } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }

  const member = await approveMemberSignup(gym, params.id);
  if (!member) {
    return NextResponse.json({ error: "Request not found, already handled, or that email is already registered" }, { status: 409 });
  }
  return NextResponse.json({ memberId: member.id });
}
