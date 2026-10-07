import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { deleteBlob, putPrivateFile } from "@/lib/blob";
import { transferProofSchema } from "@/lib/validation/tenant";

const MAX_PROOF_BYTES = 2 * 1024 * 1024;
const ALLOWED_PROOF_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * The owner attaches evidence of their bank transfer (a screenshot, plus who sent it) to the gym's open
 * subscription invoice. The superadmin reviews it before confirming. Sending again replaces the earlier proof.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug, { billing: true }));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
  if (session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can submit payment proof" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const parsed = transferProofSchema.safeParse({ senderName: String(form.get("senderName") ?? ""), transferDate: form.get("transferDate") || undefined });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const proof = form.get("proof");
  if (!(proof instanceof File) || proof.size === 0) return NextResponse.json({ error: "Attach a photo or screenshot of the transfer" }, { status: 400 });
  if (!ALLOWED_PROOF_MIME.has(proof.type)) return NextResponse.json({ error: "Proof must be a JPEG, PNG or WebP image" }, { status: 400 });
  if (proof.size > MAX_PROOF_BYTES) return NextResponse.json({ error: "Proof image must be under 2MB" }, { status: 400 });

  const payment = await db.platformPayment.findFirst({
    where: { gymId: gym.id, kind: "SUBSCRIPTION", status: "PENDING", provider: "manual" },
    orderBy: { createdAt: "desc" },
  });
  if (!payment) return NextResponse.json({ error: "There's no bank-transfer invoice to attach this to. Start a payment first." }, { status: 409 });

  let url: string;
  try {
    url = await putPrivateFile(`transfer-proofs/${gym.id}-${Date.now()}`, proof, proof.type);
  } catch (err) {
    console.error("Transfer proof upload failed", err);
    return NextResponse.json({ error: "We couldn't upload that image. Please try again." }, { status: 502 });
  }

  await db.platformPayment.update({
    where: { id: payment.id },
    data: {
      proofImageUrl: url,
      proofSubmittedAt: new Date(),
      senderName: parsed.data.senderName,
      transferDate: parsed.data.transferDate ?? null,
      rejectionReason: null,
    },
  });
  if (payment.proofImageUrl) await deleteBlob(payment.proofImageUrl);

  return NextResponse.json({ ok: true });
}
