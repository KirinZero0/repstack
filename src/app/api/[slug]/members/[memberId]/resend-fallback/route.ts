import { NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { createMagicLink } from "@/lib/magicLink";
import { notifyMember } from "@/lib/notify";
import { decrypt } from "@/lib/crypto";

const FALLBACK_LINK_TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(
  _req: Request,
  { params }: { params: { slug: string; memberId: string } },
) {
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
  if (!member || member.gymId !== gym.id) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const { token } = await createMagicLink({
    memberId: member.id,
    purpose: "qr_fallback",
    expiresInMs: FALLBACK_LINK_TTL_MS,
  });
  const fallbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/my-qr?token=${token}`;

  await notifyMember(gym.id, {
    to: decrypt(member.phoneWhatsapp),
    message: `Hi ${member.fullName}, here's your gym QR code link (no login needed, valid 24h): ${fallbackUrl}`,
    type: "qr_fallback",
    memberId: member.id,
  });

  return NextResponse.json({ ok: true });
}
