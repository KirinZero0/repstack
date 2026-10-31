import type { RefundCategory, RefundMethod } from "@prisma/client";
import { dayKeyInTimezone, zonedTimeToUtc } from "./date";

export const REFUND_CATEGORY_LABEL: Record<RefundCategory, string> = {
  MEMBERSHIP: "Membership",
  CLASS: "Class",
  DAY_PASS: "Day pass",
  FIELD: "Field booking",
  OTHER: "Other",
};

export const REFUND_METHOD_LABEL: Record<RefundMethod, string> = {
  CASH: "Cash",
  TRANSFER: "Bank transfer",
};

/**
 * The instant a refund is counted on, from the day the owner picked (YYYY-MM-DD in the gym's timezone): right now
 * for today, midday for an earlier day. Null for a day in the future or a date that doesn't exist.
 */
export function refundInstant(day: string, timezone: string, now = new Date()): Date | null {
  const today = dayKeyInTimezone(now, timezone);
  if (day > today) return null;
  if (day === today) return now;
  const at = zonedTimeToUtc(`${day}T12:00`, timezone);
  return Number.isNaN(at.getTime()) || dayKeyInTimezone(at, timezone) !== day ? null : at;
}
