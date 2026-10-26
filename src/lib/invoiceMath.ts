/**
 * Invoice arithmetic, shared by the server (which is the one that counts) and the form's live
 * preview, so both always show the same numbers. No server-only imports here on purpose.
 */
export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

/** A discount off the subtotal: a percentage (0–100) or a fixed rupiah amount. */
export interface InvoiceDiscount {
  type: "PERCENT" | "AMOUNT";
  value: number;
  /** Optional wording printed on the invoice, e.g. "Early bird". */
  label?: string;
}

export const invoiceSubtotal = (items: InvoiceItem[]) => items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

/** Whole rupiah actually taken off. A percentage is rounded to the nearest rupiah; nothing can go below zero. */
export function discountAmount(subtotal: number, discount?: Pick<InvoiceDiscount, "type" | "value"> | null): number {
  if (!discount || !(discount.value > 0) || subtotal <= 0) return 0;
  const raw = discount.type === "PERCENT" ? Math.round((subtotal * discount.value) / 100) : Math.round(discount.value);
  return Math.min(Math.max(raw, 0), subtotal);
}

export function invoiceTotals(items: InvoiceItem[], discount?: InvoiceDiscount | null) {
  const subtotal = invoiceSubtotal(items);
  const off = discountAmount(subtotal, discount);
  return { subtotal, discountAmount: off, total: subtotal - off };
}

/** "10%" or "Rp 50.000" for the discount line. */
export function discountText(type: string | null, value: number): string {
  return type === "PERCENT" ? `${Number(value.toFixed(2))}%` : `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}
