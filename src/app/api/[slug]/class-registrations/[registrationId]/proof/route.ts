import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { getPrivateFile } from "@/lib/blob";

/** Staff views the transfer proof a member attached to a class booking. Private blob, tenant-scoped. */
export async function GET(_req: NextRequest, { params }: { params: { slug: string; registrationId: string } }) {
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

  const reg = await db.classRegistration.findUnique({ where: { id: params.registrationId } });
  if (!reg || reg.gymId !== gym.id || !reg.proofImageUrl) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await getPrivateFile(reg.proofImageUrl);
  if (!result) return NextResponse.json({ error: "Image unavailable" }, { status: 502 });
  return new NextResponse(result.stream, { headers: { "Content-Type": result.contentType, "Cache-Control": "private, max-age=60" } });
}
