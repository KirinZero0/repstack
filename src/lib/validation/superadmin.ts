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
