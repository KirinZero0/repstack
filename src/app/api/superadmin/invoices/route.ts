import { NextRequest, NextResponse } from "next/server";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { createInvoiceSchema } from "@/lib/validation/superadmin";
import { createInvoice, dateFromInput, invoiceTotals } from "@/lib/invoices";
import { writeAuditLog } from "@/lib/audit";

/** Superadmin issues an invoice. The subtotal, discount and total are computed here from the line items, never taken from the client. */
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

  const totals = invoiceTotals(d.items, d.discount);
  const issueDate = dateFromInput(d.issueDate);
  const invoice = await createInvoice(
    {
      gymName: d.gymName,
      billToName: d.billToName,
      billToInfo: d.billToInfo,
      items: d.items,
      subtotal: totals.subtotal,
      discountType: totals.discountAmount > 0 ? d.discount!.type : null,
      discountValue: totals.discountAmount > 0 ? d.discount!.value : 0,
      discountLabel: totals.discountAmount > 0 ? d.discount!.label : "",
      discountAmount: totals.discountAmount,
      total: totals.total,
      notes: d.notes,
      issueDate,
      dueDate: d.dueDate ? dateFromInput(d.dueDate) : null,
      createdById: session.superadminId,
    },
    issueDate.getUTCFullYear(),
  );

  await writeAuditLog({ superadminId: session.superadminId, action: "INVOICE_CREATED", metadata: { invoiceId: invoice.id, number: invoice.number, subtotal: totals.subtotal, discount: totals.discountAmount, total: Number(invoice.total) } });
  return NextResponse.json({ id: invoice.id, number: invoice.number }, { status: 201 });
}
