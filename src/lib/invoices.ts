import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export const invoiceTotal = (items: InvoiceItem[]) => items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

/** "YYYY-MM-DD" from the form → midday UTC, so the calendar day survives any timezone on display. */
export const dateFromInput = (d: string) => new Date(`${d}T12:00:00.000Z`);

/**
 * Creates an invoice with the next number of the issue year (INV-2026-0001, 0002, …). Two invoices
 * created at once can pick the same number; the unique index rejects the loser, which tries again.
 */
export async function createInvoice(data: Omit<Prisma.InvoiceUncheckedCreateInput, "number">, year: number) {
  const prefix = `INV-${year}-`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await prisma.invoice.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: "desc" }, select: { number: true } });
    const next = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
    try {
      return await prisma.invoice.create({ data: { ...data, number: `${prefix}${String(next).padStart(4, "0")}` } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("Couldn't allocate an invoice number");
}
