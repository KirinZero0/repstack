/**
 * Invoice arithmetic, shared by the server (which is the one that counts) and the form's live
 * preview, so both always show the same numbers. No server-only imports here on purpose.
 */

/** A discount on one line: a percentage (0–100) or a fixed rupiah amount off that line's price × quantity. */
export interface LineDiscount {
  type: "PERCENT" | "AMOUNT";
  value: number;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  /** Optional discount on this line only. Old invoices have none. */
  discount?: LineDiscount | null;
}

/** A discount off the whole invoice (after any line discounts): a percentage (0–100) or a fixed rupiah amount. */
export interface InvoiceDiscount {
  type: "PERCENT" | "AMOUNT";
  value: number;
  /** Optional wording printed on the invoice, e.g. "Early bird". */
  label?: string;
}

/** What a line would cost with no discount. */
export const lineGross = (i: InvoiceItem) => i.quantity * i.unitPrice;
/** Whole rupiah taken off one line. */
export const lineDiscountAmount = (i: InvoiceItem) => discountAmount(lineGross(i), i.discount);
/** What the customer pays for one line. */
export const lineNet = (i: InvoiceItem) => lineGross(i) - lineDiscountAmount(i);

/** Sum of the lines before any discount. */
export const invoiceGross = (items: InvoiceItem[]) => items.reduce((sum, i) => sum + lineGross(i), 0);
/** Total taken off by line discounts. */
export const itemDiscountTotal = (items: InvoiceItem[]) => items.reduce((sum, i) => sum + lineDiscountAmount(i), 0);
/** Sum of the lines after their own discounts. This is what an invoice-level discount applies to. */
export const invoiceSubtotal = (items: InvoiceItem[]) => items.reduce((sum, i) => sum + lineNet(i), 0);

/** Whole rupiah actually taken off. A percentage is rounded to the nearest rupiah; nothing can go below zero. */
export function discountAmount(subtotal: number, discount?: Pick<InvoiceDiscount, "type" | "value"> | null): number {
  if (!discount || !(discount.value > 0) || subtotal <= 0) return 0;
  const raw = discount.type === "PERCENT" ? Math.round((subtotal * discount.value) / 100) : Math.round(discount.value);
  return Math.min(Math.max(raw, 0), subtotal);
}

/**
 * gross → line discounts → subtotal → (optional whole-invoice discount) → total.
 * `subtotal` is after line discounts; `discountAmount` is the whole-invoice discount only.
 */
export function invoiceTotals(items: InvoiceItem[], discount?: InvoiceDiscount | null) {
  const gross = invoiceGross(items);
  const itemDiscounts = itemDiscountTotal(items);
  const subtotal = gross - itemDiscounts;
  const off = discountAmount(subtotal, discount);
  return { gross, itemDiscounts, subtotal, discountAmount: off, total: subtotal - off };
}

/** "10%" or "Rp 50.000" for the discount line. */
export function discountText(type: string | null, value: number): string {
  return type === "PERCENT" ? `${Number(value.toFixed(2))}%` : `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}
