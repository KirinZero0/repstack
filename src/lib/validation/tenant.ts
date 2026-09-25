import { z } from "zod";

export const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const memberLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const addMemberSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phoneWhatsapp: z.string().min(6).max(30),
  planId: z.string().uuid(),
});

export const activateSchema = z.object({
  password: z.string().min(8).max(72),
});

export const gymSettingsSchema = z
  .object({
    theme: z.enum(["inherit", "light", "dark", "system"]).optional(),
    acceptSignups: z.boolean().optional(),
  })
  .refine((v) => v.theme !== undefined || v.acceptSignups !== undefined, "Nothing to update");

const planFields = {
  name: z.string().trim().min(2).max(60),
  durationDays: z.number().int().min(1).max(3650),
  price: z.number().int().min(1000).max(100_000_000),
  isActive: z.boolean(),
};
export const createPlanSchema = z.object({ ...planFields, isActive: planFields.isActive.default(true) });
export const updatePlanSchema = z.object(planFields).partial().refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const payMembershipSchema = z.object({ planId: z.string().uuid() });

export const signupSchema = z.object({
  saasPlanId: z.string().uuid(),
  gymName: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Use 3-40 letters, numbers or hyphens, starting and ending with a letter or number"),
  ownerName: z.string().trim().min(2).max(80),
  ownerEmail: z.string().trim().toLowerCase().email().max(120),
  ownerPhone: z.string().trim().min(6, "Enter the WhatsApp number we can use to help you get back in.").max(30),
  password: z.string().min(8).max(72),
});

export const recordPaymentSchema = z.object({
  planId: z.string().uuid(),
  amount: z.number().int().min(1).max(100_000_000),
  /** YYYY-MM-DD, the day the money was received. Defaults to today; can't be in the future. */
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(200).optional(),
});

export const joinSchema = z.object({
  planId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(120),
  phone: z.string().trim().min(6).max(30),
  password: z.string().min(8).max(72),
});

export const whatsappConfigSchema = z.object({
  provider: z.enum(["fonnte", "wablas"]),
  senderNumber: z.string().trim().min(6).max(30),
  /** Omit (or send empty) to keep the stored key when only editing other fields. */
  apiKey: z.string().trim().min(8).max(300).optional().or(z.literal("").transform(() => undefined)),
  isActive: z.boolean(),
});

export const whatsappTestSchema = z.object({
  /** The owner's own number. If given it is saved to their profile and used for the test. */
  phone: z.string().trim().min(6).max(30).optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(8).max(72),
});

export const createStaffSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(120),
  phone: z.string().trim().min(6).max(30).optional().or(z.literal("").transform(() => undefined)),
});

export const staffActiveSchema = z.object({ isActive: z.boolean() });
