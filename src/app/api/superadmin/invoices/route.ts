import { NextRequest, NextResponse } from "next/server";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { createInvoiceSchema } from "@/lib/validation/superadmin";
import { createInvoice, dateFromInput, invoiceTotal } from "@/lib/invoices";
import { writeAuditLog } from "@/lib/audit";

/** Superadmin issues an invoice. The total is computed here from the line items, never taken from the client. */
export async function POST(req: NextRequest) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const parsed = createInvoiceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json({ error: first ? first.message : "Check the invoice and try again." }, { status: 400 });
  }
  const d = parsed.data;

  const issueDate = dateFromInput(d.issueDate);
  const invoice = await createInvoice(
    {
      gymName: d.gymName,
      billToName: d.billToName,
      billToInfo: d.billToInfo,
      items: d.items,
      total: invoiceTotal(d.items),
      notes: d.notes,
      issueDate,
      dueDate: d.dueDate ? dateFromInput(d.dueDate) : null,
      createdById: session.superadminId,
    },
    issueDate.getUTCFullYear(),
  );

  await writeAuditLog({ superadminId: session.superadminId, action: "INVOICE_CREATED", metadata: { invoiceId: invoice.id, number: invoice.number, total: Number(invoice.total) } });
  return NextResponse.json({ id: invoice.id, number: invoice.number }, { status: 201 });
}
