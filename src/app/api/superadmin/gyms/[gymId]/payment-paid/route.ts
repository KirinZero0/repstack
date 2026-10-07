import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { processPaymentEvent } from "@/lib/payments";
import { confirmTransferSchema } from "@/lib/validation/superadmin";

/**
 * Confirms a gym's bank transfer for its open subscription invoice. Runs the same code as a provider's
 * PAID callback, so the billing date, plan and suspension all update exactly as they would online.
 * Needs the owner's proof unless `withoutProof` is set. Idempotent: a second call finds nothing pending.
 */
export async function POST(req: NextRequest, { params }: { params: { gymId: string } }) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const pending = await prisma.platformPayment.findFirst({
    where: { gymId: params.gymId, kind: "SUBSCRIPTION", status: "PENDING", provider: "manual" },
    orderBy: { createdAt: "desc" },
  });
  if (!pending) return NextResponse.json({ error: "No bank transfer is waiting for this gym" }, { status: 409 });

  const parsed = confirmTransferSchema.safeParse(await req.json().catch(() => ({})));
  const withoutProof = parsed.success && parsed.data.withoutProof === true;
  if (!pending.proofImageUrl && !withoutProof) {
    return NextResponse.json({ error: "The owner hasn't sent proof of transfer yet." }, { status: 409 });
  }

  const paidAt = new Date();
  await processPaymentEvent({ id: `manual-${pending.id}`, external_id: pending.id, status: "PAID", paid_at: paidAt.toISOString() });

  await writeAuditLog({
    superadminId: session.superadminId,
    gymId: params.gymId,
    action: "SUBSCRIPTION_TRANSFER_CONFIRMED",
    metadata: { platformPaymentId: pending.id, amount: Number(pending.amount), withoutProof: !pending.proofImageUrl },
  });
  return NextResponse.json({ ok: true, paidAt });
}
