import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { gymSettingsSchema } from "./validation/tenant";

export type GymSettingsInput = z.infer<typeof gymSettingsSchema>;

/**
 * Turns a validated settings change into the gym row update: the keys that live in the `settings` JSON are
 * merged into what is already there (so nothing else is lost), and the real columns are set directly. Shared by
 * the owner's settings route and the superadmin's, so both apply a change the same way.
 */
export function gymSettingsUpdate(current: unknown, d: GymSettingsInput): Prisma.GymUpdateInput {
  const next = { ...((current ?? {}) as Record<string, unknown>) };
  if (d.theme !== undefined) {
    if (d.theme === "inherit") delete next.theme;
    else next.theme = d.theme;
  }
  if (d.acceptSignups !== undefined) next.acceptSignups = d.acceptSignups;
  if (d.paymentsEnabled !== undefined) next.paymentsEnabled = d.paymentsEnabled;
  if (d.notifyWhatsapp !== undefined) next.notifyWhatsapp = d.notifyWhatsapp;
  if (d.notifyEmail !== undefined) next.notifyEmail = d.notifyEmail;
  if (d.emailReplyTo !== undefined) {
    if (d.emailReplyTo) next.emailReplyTo = d.emailReplyTo;
    else delete next.emailReplyTo;
  }
  if (d.occupancyWindowHours !== undefined) next.occupancyWindowHours = d.occupancyWindowHours;
  if (d.checkinsPerDay !== undefined) next.checkinsPerDay = d.checkinsPerDay;
  if (d.checkinGapMinutes !== undefined) next.checkinGapMinutes = d.checkinGapMinutes;
  if (d.whoIsInEnabled !== undefined) next.whoIsInEnabled = d.whoIsInEnabled;

  return {
    settings: next as Prisma.InputJsonValue,
    ...(d.name !== undefined ? { name: d.name } : {}),
    ...(d.timezone !== undefined ? { timezone: d.timezone } : {}),
    ...(d.bankName !== undefined ? { bankName: d.bankName || null } : {}),
    ...(d.bankAccountNumber !== undefined ? { bankAccountNumber: d.bankAccountNumber || null } : {}),
    ...(d.bankAccountHolder !== undefined ? { bankAccountHolder: d.bankAccountHolder || null } : {}),
    ...(d.description !== undefined ? { description: d.description || null } : {}),
    ...(d.address !== undefined ? { address: d.address || null } : {}),
  };
}
