import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { decrypt } from "./crypto";
import { notifyGuest, type Channel, type NotifyResult } from "./notify";
import { ticketTokenFor, ticketUrl } from "./guestPass";
import { bookingWhen, type FieldRules } from "./fieldBooking";

/** Statuses in which a booking holds its time on the field (the database rule uses the same three). */
export const HOLDING: ("APPROVED" | "ATTENDED" | "NO_SHOW")[] = ["APPROVED", "ATTENDED", "NO_SHOW"];

export const MAX_BOOKING_REQUESTS_PER_IP_HOUR = 8;
export const MAX_BOOKING_REQUESTS_PER_GYM_HOUR = 80;

export function fieldRules(f: { opensAt: number; closesAt: number; stepMinutes: number; pricePerHour: Prisma.Decimal | number }): FieldRules {
  return { opensAt: f.opensAt, closesAt: f.closesAt, stepMinutes: f.stepMinutes, pricePerHour: Number(f.pricePerHour) };
}

/** True for Postgres' "no two held bookings may overlap" refusal (exclusion violation, SQLSTATE 23P01). */
export function isOverlapError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${(err as { meta?: unknown }).meta ? JSON.stringify((err as { meta?: unknown }).meta) : ""}` : String(err);
  return /23P01|FieldBooking_no_overlap|exclusion constraint/i.test(text);
}

type BookingForMessage = {
  id: string;
  gymId: string;
  fullName: string;
  phoneWhatsapp: string;
  email: string | null;
  startsAt: Date;
  endsAt: Date;
  ticketSecret: string;
  amount: Prisma.Decimal | number;
  field: { name: string };
};

const contact = (b: BookingForMessage) => ({ name: b.fullName, phone: decrypt(b.phoneWhatsapp), email: b.email ? decrypt(b.email) : null });

async function loadForMessage(id: string) {
  return prisma.fieldBooking.findUnique({ where: { id }, include: { field: true, gym: true } });
}

/** "We got your request": automatic, so email only. Says plainly that the time isn't held yet. Never throws. */
export async function sendBookingReceived(id: string): Promise<void> {
  try {
    const b = await loadForMessage(id);
    if (!b || b.isBlock) return;
    const price = Number(b.amount) > 0 ? ` (Rp ${Number(b.amount).toLocaleString("id-ID")})` : "";
    await notifyGuest(b.gymId, {
      ...contact(b),
      trigger: "auto",
      type: "field_booking_received",
      message: `Hi ${b.fullName}, we got your request for ${b.field.name} at ${b.gym.name} on ${bookingWhen(b, b.gym.timezone)}${price}. We'll confirm it once ${Number(b.amount) > 0 ? "the payment is checked" : "staff have looked at it"}. The time is only yours once we do.`,
    });
  } catch (err) {
    console.error("Booking received message failed", err);
  }
}

/** The ticket, sent when staff approve (WhatsApp and email) or resend it on one chosen channel. Never throws. */
export async function sendBookingApproved(id: string, channel?: Channel): Promise<NotifyResult> {
  try {
    const b = await loadForMessage(id);
    if (!b || b.isBlock || b.status !== "APPROVED") return {};
    return await notifyGuest(b.gymId, {
      ...contact(b),
      channel,
      type: "field_booking_approved",
      message: `Hi ${b.fullName}, your booking is confirmed: ${b.field.name} at ${b.gym.name} on ${bookingWhen(b, b.gym.timezone)}. Show this QR ticket at the front desk: ${ticketUrl(ticketTokenFor(b))}`,
    });
  } catch (err) {
    console.error("Booking approved message failed", err);
    return channel ? { [channel]: "FAILED" } : {};
  }
}

export async function sendBookingRejected(id: string): Promise<void> {
  try {
    const b = await loadForMessage(id);
    if (!b || b.isBlock) return;
    await notifyGuest(b.gymId, {
      ...contact(b),
      type: "field_booking_rejected",
      message: `Hi ${b.fullName}, sorry, we couldn't confirm your booking for ${b.field.name} on ${bookingWhen(b, b.gym.timezone)}. Please contact the front desk.`,
    });
  } catch (err) {
    console.error("Booking declined message failed", err);
  }
}

export async function sendBookingCancelled(id: string, paid: boolean): Promise<void> {
  try {
    const b = await loadForMessage(id);
    if (!b || b.isBlock) return;
    await notifyGuest(b.gymId, {
      ...contact(b),
      type: "field_booking_cancelled",
      message: `Hi ${b.fullName}, your booking for ${b.field.name} at ${b.gym.name} on ${bookingWhen(b, b.gym.timezone)} has been cancelled.${paid ? " Please talk to the front desk about your payment." : ""}`,
    });
  } catch (err) {
    console.error("Booking cancelled message failed", err);
  }
}
