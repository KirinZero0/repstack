import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { deleteBlob, putPrivateFile } from "@/lib/blob";
import { proofFileError } from "@/lib/transferProof";

/**
 * A member attaches their bank-transfer screenshot to an unpaid class booking. It only goes to the
 * front desk: nothing is confirmed until staff check the money and record the payment. A newer
 * screenshot replaces the older one.
 */
export async function POST(req: NextRequest, { params }: { params: { registrationId: string } }) {
  const session = await getSession();
  if (!session || session.kind !== "member") {
    return NextResponse.json({ error: "Log in as a member first" }, { status: 401 });
  }

  const db = tenantDb(session.gymId);
  const reg = await db.classRegistration.findUnique({ where: { id: params.registrationId }, include: { payment: true, session: true } });
  // Only the member's own registration, in their own gym.
  if (!reg || reg.gymId !== session.gymId || reg.memberId !== session.memberId) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (reg.status !== "PENDING_PAYMENT") return NextResponse.json({ error: "This booking doesn't need a payment." }, { status: 409 });
  if (reg.session.status !== "SCHEDULED" || reg.session.startsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "This session has already started." }, { status: 409 });
  }
  if (reg.payment?.status === "PENDING" && reg.payment.externalInvoiceId) {
    return NextResponse.json({ error: "This booking is being paid online. Use the payment link instead." }, { status: 409 });
  }

  const form = await req.formData().catch(() => null);
  const proof = form?.get("proof");
  if (!(proof instanceof File) || proof.size === 0) return NextResponse.json({ error: "Choose a screenshot of your transfer." }, { status: 400 });
  const bad = proofFileError(proof);
  if (bad) return bad;

  let url: string;
  try {
    url = await putPrivateFile(`class-proofs/${session.gymId}-${reg.id}-${Date.now()}`, proof, proof.type);
  } catch (err) {
    console.error("Class proof upload failed", err);
    return NextResponse.json({ error: "We couldn't save your screenshot. Try again in a moment." }, { status: 502 });
  }
  await db.classRegistration.update({ where: { id: reg.id }, data: { proofImageUrl: url, proofSubmittedAt: new Date() } });
  if (reg.proofImageUrl) await deleteBlob(reg.proofImageUrl);
  return NextResponse.json({ ok: true });
}
