import { NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { channelProblem, notifyMember } from "@/lib/notify";
import { readChannel } from "@/lib/channel";
import { decrypt } from "@/lib/crypto";

/**
 * Owner or staff nudges one gym member about their membership: coming up to expiry, expired, or
 * not yet paid. Frozen and cancelled members are left alone.
 */
export async function POST(req: Request, { params }: { params: { slug: string; memberId: string } }) {
  let gym, db;
  try {
    ({ gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }

  // Tenant isolation: the member must belong to the session's gym.
  const member = await db.member.findUnique({ where: { id: params.memberId } });
  if (!member || member.gymId !== gym.id || member.anonymizedAt) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const expiry = member.membershipExpiry?.toLocaleDateString("id-ID", { timeZone: gym.timezone });
  let message: string;
  switch (member.status) {
    case "ACTIVE":
      message = expiry
        ? `Hi ${member.fullName}, a reminder that your ${gym.name} membership ${member.membershipExpiry! < new Date() ? "expired" : "expires"} on ${expiry}. Renew soon to keep your access active.`
        : `Hi ${member.fullName}, a reminder from ${gym.name} about your membership.`;
      break;
    case "EXPIRED":
      message = `Hi ${member.fullName}, your ${gym.name} membership has expired. Renew to regain access.`;
      break;
    case "PENDING_PAYMENT":
      message = `Hi ${member.fullName}, your ${gym.name} membership is waiting for payment. Please pay to activate it.`;
      break;
    default:
      return NextResponse.json({ error: "This member is frozen or cancelled, so there's nothing to remind them about." }, { status: 409 });
  }

  const channel = await readChannel(req);
  const result = await notifyMember(gym.id, { to: decrypt(member.phoneWhatsapp), message, type: "manual_reminder", memberId: member.id, trigger: "manual", channel });
  const problem = channel ? channelProblem(result, channel) : null;
  if (problem) return NextResponse.json({ error: problem }, { status: 409 });
  return NextResponse.json({ ok: true });
}
