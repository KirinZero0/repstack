import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { createPasswordReset, deliverResetLink, resetUrl } from "@/lib/passwordReset";

/** Owner generates a fresh password link for a staff member (forgotten password, or a lost invite). */
export async function POST(_req: Request, { params }: { params: { slug: string; staffId: string } }) {
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
  if (session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can create reset links" }, { status: 403 });
  }

  const staff = await prisma.staffUser.findUnique({ where: { id: params.staffId } });
  if (!staff || staff.gymId !== gym.id) return NextResponse.json({ error: "Staff account not found" }, { status: 404 });
  if (!staff.isActive) return NextResponse.json({ error: "Reactivate this account first." }, { status: 409 });

  const token = await createPasswordReset({ kind: "staff", subjectId: staff.id, purpose: "reset" });
  waitUntil(deliverResetLink({ kind: "staff", name: staff.name, token, purpose: "reset", staffPhone: staff.phone, gymName: gym.name }));
  return NextResponse.json({ url: resetUrl(token) });
}
