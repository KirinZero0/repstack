import { z } from "zod";

export const superadminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createGymSchema = z.object({
  gymName: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  saasPlanId: z.string().uuid(),
  isLifetime: z.boolean().default(false),
  // Free trial before the first invoice. Off = the first invoice goes out at the next billing run. Ignored for lifetime gyms.
  allowTrial: z.boolean().default(true),
  trialDays: z.number().int().min(1).max(365).default(14),
  // Optional one-time onboarding charge (e.g. importing their member list by hand). Whole rupiah; 0 = none.
  setupFee: z.number().int().min(0).max(1_000_000_000).default(0),
  setupFeePaid: z.boolean().default(false),
  ownerName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  ownerPhone: z.string().min(6).max(30).optional(),
  ownerTempPassword: z.string().min(8).max(72),
});

export const platformSettingsSchema = z.object({
  themeDefault: z.enum(["light", "dark", "system"]),
  allowUserOverride: z.boolean(),
});

export const platformBankSchema = z.object({
  bankName: z.string().trim().min(2).max(60),
  accountNumber: z.string().trim().min(4).max(40).regex(/^[\d\s-]+$/, "Digits only"),
  accountHolder: z.string().trim().min(2).max(80),
});

export const rejectTransferSchema = z.object({ reason: z.string().trim().min(3, "Give a short reason").max(300) });

export const confirmTransferSchema = z.object({
  // Confirm a transfer that has no screenshot (cash deposit, bank-app transfer): the superadmin vouches for it.
  withoutProof: z.boolean().optional(),
});

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

export const createInvoiceSchema = z
  .object({
    billToName: z.string().trim().min(2).max(120),
    billToInfo: z.string().trim().max(500).default(""),
    issueDate: dateOnly,
    dueDate: dateOnly.optional(),
    notes: z.string().trim().max(1000).default(""),
    items: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(200),
          quantity: z.number().int().min(1).max(10_000),
          // Whole rupiah. 0 is allowed so a free line (e.g. training) can show on the invoice.
          unitPrice: z.number().int().min(0).max(10_000_000_000),
        }),
      )
      .min(1)
      .max(30),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.issueDate, { message: "Due date can't be before the issue date", path: ["dueDate"] });

export const invoiceActionSchema = z.object({ action: z.enum(["paid", "unpaid", "void"]) });
