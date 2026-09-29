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
  /** YYYY-MM-DD. Defaults to the plan's standard duration from today when left blank. */
  membershipExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Every public form makes people accept the terms and privacy policy; the time is stored with the account. */
export const acceptTermsField = z.literal(true, { message: "Please accept the terms and privacy policy to continue." });

export const activateSchema = z.object({
  password: z.string().min(8).max(72),
  acceptTerms: acceptTermsField,
});

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const gymSettingsSchema = z
  .object({
    theme: z.enum(["inherit", "light", "dark", "system"]).optional(),
    acceptSignups: z.boolean().optional(),
    paymentsEnabled: z.boolean().optional(),
    name: z.string().trim().min(2).max(80).optional(),
    timezone: z.string().trim().max(60).refine(isValidTimezone, "Unknown timezone").optional(),
    bankName: z.string().trim().max(60).optional(),
    bankAccountNumber: z.string().trim().max(40).optional(),
    bankAccountHolder: z.string().trim().max(80).optional(),
    /** Public profile page (/[slug]). Empty string clears the field. */
    description: z.string().trim().max(1000).optional(),
    address: z.string().trim().max(200).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

/** Owner removes one gym photo by its stored URL. */
export const removeGymPhotoSchema = z.object({ url: z.string().url().max(500) });

/** How many photos a gym's public profile can hold. Enforced server-side. */
export const MAX_GYM_PHOTOS = 8;

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
  acceptTerms: acceptTermsField,
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
  acceptTerms: acceptTermsField,
});

export const memberActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("freeze") }),
  z.object({ action: z.literal("unfreeze") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("reactivate") }),
  z.object({
    action: z.literal("edit"),
    fullName: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().toLowerCase().email().max(120).optional(),
    phone: z.string().trim().min(6).max(30).optional(),
    planId: z.string().uuid().optional(),
  }),
]);

/** Owner erases a member: must type the member's current name, so it can't happen by a stray click. */
export const eraseMemberSchema = z.object({ confirmName: z.string().trim().min(1).max(120) });

/** A member erases their own account and proves it's them with their password. */
export const eraseSelfSchema = z.object({ password: z.string().min(1).max(200) });

export const changePlanSchema = z.object({ saasPlanId: z.string().uuid() });

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

// ─── Classes ────────────────────────────────────────────────

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

const classFields = {
  name: z.string().trim().min(2).max(80),
  description: optionalText(1000),
  instructor: optionalText(80),
  /** Whole rupiah. 0 = free (registration confirms straight away, no payment). */
  price: z.number().int().min(0).max(100_000_000),
  /** Seats per session; null/omitted = unlimited. */
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(600),
  isActive: z.boolean(),
};
export const createClassSchema = z.object({ ...classFields, isActive: classFields.isActive.default(true) });
export const updateClassSchema = z.object(classFields).partial().refine((v) => Object.keys(v).length > 0, "Nothing to update");

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Schedules one session, or the same slot weekly `repeatWeeks` times (one row each — no recurrence rule). */
export const createClassSessionSchema = z.object({
  /** Wall-clock time in the gym's timezone, "YYYY-MM-DDTHH:mm" (a datetime-local input). */
  startsAt: z.string().regex(LOCAL_DATETIME, "Pick a date and time"),
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
  repeatWeeks: z.number().int().min(1).max(52).default(1),
});

export const classSessionActionSchema = z.object({ action: z.enum(["cancel"]) });

/** Staff confirms a member's registration by recording what they paid at the front desk. */
export const confirmClassRegistrationSchema = z.object({
  amount: z.number().int().min(0).max(100_000_000),
  note: z.string().trim().max(200).optional(),
});

export const registerForClassSchema = z.object({ sessionId: z.string().uuid() });
