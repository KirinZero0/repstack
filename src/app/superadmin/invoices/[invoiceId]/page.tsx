import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { getPlatformBank } from "@/lib/platformBank";
import type { InvoiceItem } from "@/lib/invoices";
import InvoiceControls from "./InvoiceControls";

export const dynamic = "force-dynamic";

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const day = (d: Date) => d.toLocaleDateString("id-ID", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

/** The invoice as a white sheet. "Print / save as PDF" uses the browser's print dialog; the chrome around the sheet is hidden in print. */
export default async function InvoicePage({ params }: { params: { invoiceId: string } }) {
  try {
    await requireSuperadminSession();
  } catch (err) {
    if (err instanceof SessionError) redirect("/superadmin/login");
    throw err;
  }
  const invoice = await prisma.invoice.findUnique({ where: { id: params.invoiceId } });
  if (!invoice) notFound();
  const bank = await getPlatformBank();
  const items = invoice.items as unknown as InvoiceItem[];

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <a href="/superadmin/invoices" className="text-sm text-neutral-300 hover:text-white">‹ All invoices</a>
          <InvoiceControls invoiceId={invoice.id} status={invoice.status} />
        </div>

        <article className="relative rounded-xl bg-white p-10 text-neutral-900 print:rounded-none print:p-0">
          {invoice.status !== "UNPAID" && (
            <p className={`absolute right-10 top-10 rotate-6 rounded border-2 px-3 py-1 text-lg font-bold uppercase tracking-widest print:right-0 print:top-0 ${invoice.status === "PAID" ? "border-emerald-600 text-emerald-600" : "border-neutral-400 text-neutral-400"}`}>
              {invoice.status === "PAID" ? "Paid" : "Void"}
            </p>
          )}
          <header className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Invoice</h1>
              <p className="mt-1 text-sm text-neutral-500">{invoice.number}</p>
            </div>
            <p className="text-xl font-semibold">Liftmora</p>
          </header>

          <section className="mt-8 grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">Billed to</p>
              <p className="mt-1 font-medium">{invoice.billToName}</p>
              {invoice.billToInfo && <p className="whitespace-pre-line text-neutral-600">{invoice.billToInfo}</p>}
            </div>
            <div className="text-right">
              <p><span className="text-neutral-500">Issued:</span> {day(invoice.issueDate)}</p>
              {invoice.dueDate && <p><span className="text-neutral-500">Due:</span> {day(invoice.dueDate)}</p>}
            </div>
          </section>

          <table className="mt-8 w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
                <th className="py-2">Description</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={idx} className="border-b border-neutral-200">
                  <td className="py-2">{i.description}</td>
                  <td className="py-2 text-right">{i.quantity}</td>
                  <td className="py-2 text-right">{i.unitPrice === 0 ? "Free" : rp(i.unitPrice)}</td>
                  <td className="py-2 text-right">{i.unitPrice === 0 ? "Free" : rp(i.quantity * i.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-4 text-right font-semibold">Total</td>
                <td className="pt-4 text-right text-lg font-bold">{rp(Number(invoice.total))}</td>
              </tr>
            </tfoot>
          </table>

          {bank && (
            <section className="mt-10 text-sm">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Pay by bank transfer</p>
              <p className="mt-1">{bank.bankName} · {bank.accountNumber}</p>
              <p className="text-neutral-600">a/n {bank.accountHolder}</p>
              <p className="text-neutral-600">Reference: {invoice.number}</p>
            </section>
          )}
          {invoice.notes && <p className="mt-6 whitespace-pre-line text-sm text-neutral-600">{invoice.notes}</p>}
        </article>
      </div>
    </main>
  );
}
