import type { Prisma } from "@prisma/client";

/**
 * Why a gym is suspended. Stored in Gym.settings.suspendedFor. A gym the cron suspended for an unpaid
 * subscription ("non_payment") lets its owner reach the billing page to pay; one a superadmin suspended
 * (no reason stored) is locked out of everything.
 */
export function suspendedForNonPayment(settings: unknown): boolean {
  return (settings as { suspendedFor?: unknown } | null)?.suspendedFor === "non_payment";
}

/** A copy of the settings with the suspension reason set, or cleared when `reason` is null. */
export function withSuspensionReason(settings: unknown, reason: "non_payment" | null): Prisma.InputJsonValue {
  const next = { ...((settings ?? {}) as Record<string, unknown>) };
  if (reason) next.suspendedFor = reason;
  else delete next.suspendedFor;
  return next as Prisma.InputJsonValue;
}
