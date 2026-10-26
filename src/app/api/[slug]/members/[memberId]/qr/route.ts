import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireTenantSession, SessionError } from "@/lib/session";
import { buildQrToken } from "@/lib/qr";

/**
 * Staff or owner opens a member's check-in QR, for a member who has no phone or no login yet. Fetched on
 * demand (never put in the page) and fresh each time, scoped to the session's own gym. It is the same code
 * the member sees on /my-qr, so it is only ever shown to signed-in staff.
 */
export async function GET(_req: NextRequest, { params }: { params: { slug: string; memberId: string } }) {
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

  const member = await db.member.findUnique({ where: { id: params.memberId } });
  if (!member || member.gymId !== gym.id || member.anonymizedAt) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const token = buildQrToken({ gymId: gym.id, memberId: member.id, issuedAt: Date.now() }, member.qrSecret);
  const dataUrl = await QRCode.toDataURL(token, { width: 320, margin: 2 });
  return NextResponse.json({ name: member.fullName, status: member.status, dataUrl }, { headers: { "Cache-Control": "no-store" } });
}
