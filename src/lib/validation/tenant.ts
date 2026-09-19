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

export const gymThemeSchema = z.object({
  theme: z.enum(["inherit", "light", "dark", "system"]),
});

const planFields = {
  name: z.string().trim().min(2).max(60),
  durationDays: z.number().int().min(1).max(3650),
  price: z.number().int().min(1000).max(100_000_000),
  isActive: z.boolean(),
};
export const createPlanSchema = z.object({ ...planFields, isActive: planFields.isActive.default(true) });
export const updatePlanSchema = z.object(planFields).partial().refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const payMembershipSchema = z.object({ planId: z.string().uuid() });
