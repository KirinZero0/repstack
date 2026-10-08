import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { invoiceActionSchema } from "@/lib/validation/superadmin";
import { writeAuditLog } from "@/lib/audit";

/** Mark an invoice paid, back to unpaid, or void. Invoices are never deleted, so numbers stay unbroken. */
export async function PATCH(req: NextRequest, { params }: { params: { invoiceId: string } }) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const parsed = invoiceActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const invoice = await prisma.invoice.findUnique({ where: { id: params.invoiceId } });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status === "VOID") return NextResponse.json({ error: "This invoice is void." }, { status: 409 });

  const next = parsed.data.action === "paid" ? "PAID" : parsed.data.action === "void" ? "VOID" : "UNPAID";
  if (invoice.status === next) return NextResponse.json({ ok: true, status: next });

  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: next, paidAt: next === "PAID" ? new Date() : null } });
  await writeAuditLog({ superadminId: session.superadminId, action: `INVOICE_${next}`, metadata: { invoiceId: invoice.id, number: invoice.number } });
  return NextResponse.json({ ok: true, status: next });
}
