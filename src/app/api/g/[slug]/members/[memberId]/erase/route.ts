import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { eraseMemberSchema } from "@/lib/validation/tenant";
import { eraseMember } from "@/lib/erasure";

/** Owner erases a member's personal data (privacy request). Irreversible; payment history is kept, anonymised. */
export async function POST(req: NextRequest, { params }: { params: { slug: string; memberId: string } }) {
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
  if (session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can erase a member's data" }, { status: 403 });
  }

  const parsed = eraseMemberSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Type the member's name to confirm." }, { status: 400 });

  // Tenant isolation: the member must belong to the session's gym before the (unrestricted) eraser runs.
  const member = await db.member.findUnique({ where: { id: params.memberId } });
  if (!member || member.gymId !== gym.id) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (member.anonymizedAt) return NextResponse.json({ error: "Already erased." }, { status: 409 });

  if (parsed.data.confirmName.toLowerCase() !== member.fullName.trim().toLowerCase()) {
    return NextResponse.json({ error: "That doesn't match the member's name." }, { status: 400 });
  }

  await eraseMember(member.id);
  return NextResponse.json({ ok: true });
}
