import { z } from "zod";

/** How money handed to the gym arrived. Matches the PaymentMethod enum in the schema. */
export const PAYMENT_METHODS = ["CASH", "TRANSFER", "QRIS"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { CASH: "Cash", TRANSFER: "Transfer", QRIS: "QRIS" };

/** The optional `method` every staff money form sends. Left out, the route uses its own default. */
export const paymentMethodField = z.enum(PAYMENT_METHODS).optional();

/**
 * The label for a recorded payment: what staff chose, "Online" for a gateway payment, or "Not recorded" for desk
 * money entered before the method was asked.
 */
export function methodLabel(method: PaymentMethod | null | undefined, provider?: string | null): string {
  if (method) return PAYMENT_METHOD_LABEL[method];
  if (provider === "XENDIT" || provider === "MIDTRANS") return "Online";
  return "Not recorded";
}
