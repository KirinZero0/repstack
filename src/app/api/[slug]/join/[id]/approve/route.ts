import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { approveMemberSignup } from "@/lib/memberSignup";
import { approveSignupSchema } from "@/lib/validation/tenant";

/**
 * Staff confirms a manual bank-transfer request: a join request becomes an active member, a
 * renewal request extends the existing member. Either way a PAID (CASH) payment is recorded.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string; id: string } }) {
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

  // The body is optional: an older client sends none, and the payment is then recorded as a transfer.
  const parsed = approveSignupSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const member = await approveMemberSignup(gym, params.id, { recordedById: session.staffUserId, method: parsed.data.method ?? "TRANSFER" });
  if (!member) {
    return NextResponse.json(
      { error: "Request not found, already handled, that email is already registered, or the member's account is cancelled" },
      { status: 409 },
    );
  }
  return NextResponse.json({ memberId: member.id });
}
