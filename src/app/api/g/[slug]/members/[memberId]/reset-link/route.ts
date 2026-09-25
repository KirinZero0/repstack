import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { createPasswordReset, deliverResetLink, resetUrl } from "@/lib/passwordReset";

/** Owner or staff creates a password link for a member, e.g. one who forgot it at the front desk. */
export async function POST(_req: Request, { params }: { params: { slug: string; memberId: string } }) {
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

  const member = await prisma.member.findUnique({ where: { id: params.memberId } });
  if (!member || member.gymId !== gym.id) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const token = await createPasswordReset({ kind: "member", subjectId: member.id, purpose: "reset" });
  waitUntil(
    deliverResetLink({
      kind: "member",
      name: member.fullName,
      token,
      purpose: "reset",
      member: { id: member.id, gymId: member.gymId, encryptedPhone: member.phoneWhatsapp },
      gymName: gym.name,
    }),
  );
  return NextResponse.json({ url: resetUrl(token) });
}
