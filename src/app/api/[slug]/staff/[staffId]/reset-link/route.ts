import { NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { createPasswordReset, deliverResetLink, resetUrl } from "@/lib/passwordReset";
import { channelProblem } from "@/lib/notify";
import { readChannel } from "@/lib/channel";

/** Owner generates a fresh password link for a staff member (forgotten password, or a lost invite). */
export async function POST(req: Request, { params }: { params: { slug: string; staffId: string } }) {
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
    return NextResponse.json({ error: "Only the owner can create reset links" }, { status: 403 });
  }

  const staff = await db.staffUser.findUnique({ where: { id: params.staffId } });
  if (!staff || staff.gymId !== gym.id) return NextResponse.json({ error: "Staff account not found" }, { status: 404 });
  if (!staff.isActive) return NextResponse.json({ error: "Reactivate this account first." }, { status: 409 });

  const token = await createPasswordReset({ kind: "staff", subjectId: staff.id, purpose: "reset" });
  const channel = await readChannel(req);
  const sent = await deliverResetLink({ kind: "staff", name: staff.name, token, purpose: "reset", staffPhone: staff.phone, staffEmail: staff.email, gymId: gym.id, gymName: gym.name, trigger: "manual", channel });
  return NextResponse.json({ url: resetUrl(token), sendError: channel ? channelProblem(sent, channel) : null });
}
