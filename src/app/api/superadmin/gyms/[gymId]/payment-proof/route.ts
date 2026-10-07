import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { getPrivateFile } from "@/lib/blob";

/** Superadmin views the transfer screenshot on a gym's open bank-transfer invoice. Private blob, streamed through here. */
export async function GET(_req: Request, { params }: { params: { gymId: string } }) {
  try {
    await requireSuperadminSession();
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const payment = await prisma.platformPayment.findFirst({
    where: { gymId: params.gymId, kind: "SUBSCRIPTION", status: "PENDING", provider: "manual", proofImageUrl: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!payment?.proofImageUrl) return NextResponse.json({ error: "No proof submitted" }, { status: 404 });

  const result = await getPrivateFile(payment.proofImageUrl);
  if (!result) return NextResponse.json({ error: "Image unavailable" }, { status: 502 });
  return new NextResponse(result.stream, { headers: { "Content-Type": result.contentType, "Cache-Control": "private, no-store" } });
}
