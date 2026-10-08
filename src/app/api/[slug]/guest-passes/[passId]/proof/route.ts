import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { getPrivateFile } from "@/lib/blob";

/** Staff views the bank-transfer proof a guest attached to their request. Private blob, tenant-scoped. */
export async function GET(_req: NextRequest, { params }: { params: { slug: string; passId: string } }) {
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

  const pass = await db.guestPass.findUnique({ where: { id: params.passId } });
  if (!pass || pass.gymId !== gym.id || !pass.proofImageUrl) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await getPrivateFile(pass.proofImageUrl);
  if (!result) return NextResponse.json({ error: "Image unavailable" }, { status: 502 });
  return new NextResponse(result.stream, { headers: { "Content-Type": result.contentType, "Cache-Control": "private, max-age=60" } });
}
