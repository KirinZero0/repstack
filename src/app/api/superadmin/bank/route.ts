import { NextRequest, NextResponse } from "next/server";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { platformBankSchema } from "@/lib/validation/superadmin";
import { setPlatformBank } from "@/lib/platformBank";
import { writeAuditLog } from "@/lib/audit";

/** The bank account gyms transfer their Liftmora subscription to. */
export async function POST(req: NextRequest) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const parsed = platformBankSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  await setPlatformBank(parsed.data);
  await writeAuditLog({ superadminId: session.superadminId, action: "PLATFORM_BANK_UPDATED", metadata: { bankName: parsed.data.bankName } });
  return NextResponse.json({ ok: true });
}
