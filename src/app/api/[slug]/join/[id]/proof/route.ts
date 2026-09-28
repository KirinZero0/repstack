import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { requireTenantSession, SessionError } from "@/lib/session";

/** Staff views the proof-of-transfer image for a pending manual join request. Private blob, tenant-scoped. */
export async function GET(_req: NextRequest, { params }: { params: { slug: string; id: string } }) {
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

  const signup = await db.memberSignup.findUnique({ where: { id: params.id } });
  if (!signup || signup.gymId !== gym.id || !signup.proofImageUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await get(signup.proofImageUrl, { access: "private" }).catch(() => null);
  if (!result || !result.stream) return NextResponse.json({ error: "Image unavailable" }, { status: 502 });

  return new NextResponse(result.stream, {
    headers: { "Content-Type": result.blob.contentType, "Cache-Control": "private, max-age=60" },
  });
}
