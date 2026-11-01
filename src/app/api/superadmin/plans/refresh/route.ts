import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { SAAS_PLANS_TAG } from "@/lib/landingPlans";

/**
 * Clears the cached plan prices, so the landing page reads the SaaS plans from the database again on its next
 * visit. Plans change only by script; this is how those changes reach the landing page.
 */
export async function POST() {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  revalidateTag(SAAS_PLANS_TAG);
  await writeAuditLog({ superadminId: session.superadminId, action: "PLAN_PRICES_REFRESHED", metadata: {} });
  return NextResponse.json({ ok: true });
}
