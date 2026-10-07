import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { deleteBlob } from "@/lib/blob";
import { rejectTransferSchema } from "@/lib/validation/superadmin";

/** Rejects the submitted transfer proof. The invoice stays open; the owner sees the reason and can send new proof. */
export async function POST(req: NextRequest, { params }: { params: { gymId: string } }) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const parsed = rejectTransferSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Give a reason" }, { status: 400 });

  const pending = await prisma.platformPayment.findFirst({
    where: { gymId: params.gymId, kind: "SUBSCRIPTION", status: "PENDING", provider: "manual" },
    orderBy: { createdAt: "desc" },
  });
  if (!pending) return NextResponse.json({ error: "No bank transfer is waiting for this gym" }, { status: 409 });

  await prisma.platformPayment.update({
    where: { id: pending.id },
    data: { proofImageUrl: null, proofSubmittedAt: null, senderName: null, transferDate: null, rejectionReason: parsed.data.reason },
  });
  if (pending.proofImageUrl) await deleteBlob(pending.proofImageUrl);

  await writeAuditLog({
    superadminId: session.superadminId,
    gymId: params.gymId,
    action: "SUBSCRIPTION_TRANSFER_REJECTED",
    metadata: { platformPaymentId: pending.id, reason: parsed.data.reason },
  });
  return NextResponse.json({ ok: true });
}
