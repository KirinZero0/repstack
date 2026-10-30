import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { getPrivateFile } from "@/lib/blob";

/** Staff views the bank-transfer proof attached to a field booking request. Private blob, tenant-scoped. */
export async function GET(_req: NextRequest, { params }: { params: { slug: string; bookingId: string } }) {
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
  const booking = await db.fieldBooking.findUnique({ where: { id: params.bookingId } });
  if (!booking || booking.gymId !== gym.id || !booking.proofImageUrl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const result = await getPrivateFile(booking.proofImageUrl);
  if (!result) return NextResponse.json({ error: "Image unavailable" }, { status: 502 });
  return new NextResponse(result.stream, { headers: { "Content-Type": result.contentType, "Cache-Control": "private, max-age=60" } });
}
