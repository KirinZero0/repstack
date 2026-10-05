import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { putPrivateFile } from "@/lib/blob";
import { renewalRequestSchema } from "@/lib/validation/tenant";

const MAX_PROOF_BYTES = 2 * 1024 * 1024;
const ALLOWED_PROOF_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * A logged-in member renews by transferring to the gym's bank account and filing a request here,
 * proof image optional. Staff confirm it from the same pending-requests queue as join requests;
 * approval extends the membership and records a CASH payment. One open request per member.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.kind !== "member") {
    return NextResponse.json({ error: "Log in as a member to renew" }, { status: 401 });
  }

  const db = tenantDb(session.gymId);
  const [member, gym] = await Promise.all([
    db.member.findUnique({ where: { id: session.memberId } }),
    db.gym.findUnique({ where: { id: session.gymId } }),
  ]);
  if (!member || !gym || member.gymId !== gym.id || member.anonymizedAt) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
    return NextResponse.json({ error: "This gym can't take payments right now" }, { status: 403 });
  }
  if (member.status === "CANCELLED") {
    return NextResponse.json({ error: "This membership was cancelled. Ask the gym to reactivate it." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const parsed = renewalRequestSchema.safeParse({ planId: form?.get("planId") });
  if (!parsed.success) return NextResponse.json({ error: "Pick a plan" }, { status: 400 });

  // Tenant isolation: only this gym's plans that are on sale.
  const plan = await db.membershipPlan.findUnique({ where: { id: parsed.data.planId } });
  if (!plan || plan.gymId !== gym.id || !plan.isActive) {
    return NextResponse.json({ error: "That plan isn't available. Pick another." }, { status: 400 });
  }

  const proof = form?.get("proof");
  if (proof instanceof File && proof.size > 0) {
    if (!ALLOWED_PROOF_MIME.has(proof.type)) return NextResponse.json({ error: "Proof image must be JPEG, PNG, or WebP" }, { status: 400 });
    if (proof.size > MAX_PROOF_BYTES) return NextResponse.json({ error: "Proof image must be under 2MB" }, { status: 400 });
  }

  const open = await db.memberSignup.findFirst({ where: { gymId: gym.id, memberId: member.id, kind: "RENEWAL", status: "PENDING_REVIEW" } });
  if (open) {
    return NextResponse.json({ error: "You already have a renewal waiting for the gym to confirm." }, { status: 409 });
  }

  let proofImageUrl: string | undefined;
  if (proof instanceof File && proof.size > 0) {
    // Proof is optional; a storage hiccup must not block the request itself.
    try {
      proofImageUrl = await putPrivateFile(`renewal-proofs/${gym.id}-${member.id}-${Date.now()}`, proof, proof.type);
    } catch (err) {
      console.error("Renewal proof upload failed, continuing without it", err);
    }
  }

  const request = await db.memberSignup.create({
    data: {
      gymId: gym.id,
      planId: plan.id,
      kind: "RENEWAL",
      memberId: member.id,
      fullName: member.fullName,
      email: member.email,
      phoneWhatsapp: member.phoneWhatsapp,
      phoneWhatsappLookup: member.phoneWhatsappLookup,
      passwordHash: null,
      amount: plan.price,
      status: "PENDING_REVIEW",
      proofImageUrl,
      termsAcceptedAt: member.termsAcceptedAt,
    },
  });

  return NextResponse.json({ requestId: request.id }, { status: 201 });
}
