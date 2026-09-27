import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { rejectMemberSignup } from "@/lib/memberSignup";

/** Staff couldn't confirm a manual bank-transfer request. No member is created. */
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

  const signup = await rejectMemberSignup(gym, params.id);
  if (!signup) return NextResponse.json({ error: "Request not found or already handled" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
