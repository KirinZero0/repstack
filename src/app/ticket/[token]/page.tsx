import QRCode from "qrcode";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { parseTicketToken, verifyTicketToken } from "@/lib/qr";
import { passIsCancelled, passTitle, passWhen, passWindow } from "@/lib/guestPass";
import { bookingWhen, bookingWindow } from "@/lib/fieldBooking";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket", robots: { index: false } };

/**
 * A guest's one-time class ticket. The signed token in the URL is the credential, like a member's
 * fallback QR link: it shows the QR only while the pass is approved and unused, and nothing about
 * anyone else. No session, so this reads with the owner client after verifying the signature.
 */
export default async function TicketPage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  const payload = parseTicketToken(token);
  const pass = payload
    ? await prisma.guestPass.findUnique({ where: { id: payload.passId }, include: { session: { include: { class: true } }, dayPassPlan: true, gym: true } })
    : null;
  // A field booking's ticket is signed the same way; its id is looked up when it isn't a guest pass.
  const booking =
    payload && !pass ? await prisma.fieldBooking.findUnique({ where: { id: payload.passId }, include: { field: true, gym: true } }) : null;
  const validBooking = booking && !booking.isBlock && booking.gymId === payload?.gymId && verifyTicketToken(token, booking.ticketSecret);
  const valid = (pass && pass.gymId === payload?.gymId && verifyTicketToken(token, pass.ticketSecret)) || validBooking;

  let body: React.ReactNode;
  if (validBooking && booking) {
    if (booking.status === "ATTENDED") {
      body = <p className="text-neutral-300" data-testid="ticket-used">This ticket has already been used.</p>;
    } else if (booking.status !== "APPROVED" || bookingWindow(booking) === "OVER") {
      body = <p className="text-neutral-300">This ticket is no longer valid.</p>;
    } else {
      const qr = await QRCode.toDataURL(token, { width: 480, margin: 2 });
      body = (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Ticket QR code" className="mx-auto w-64 rounded-xl bg-white p-2" data-testid="ticket-qr" />
          <p className="mt-4 font-medium">{booking.fullName}</p>
          <p className="text-neutral-300">{booking.field.name}</p>
          <p className="text-sm text-neutral-400">{bookingWhen(booking, booking.gym.timezone)}</p>
          <p className="mt-4 text-sm text-neutral-500">Show this at the front desk when you arrive.</p>
        </>
      );
    }
  } else if (!valid || !pass) {
    body = <p className="text-neutral-300">This ticket link isn&apos;t valid.</p>;
  } else if (pass.status === "ATTENDED") {
    body = <p className="text-neutral-300" data-testid="ticket-used">This ticket has already been used.</p>;
  } else if (pass.status !== "APPROVED" || passIsCancelled(pass) || passWindow(pass, pass.gym.timezone) === "OVER") {
    body = <p className="text-neutral-300">This ticket is no longer valid.</p>;
  } else {
    const qr = await QRCode.toDataURL(token, { width: 480, margin: 2 });
    body = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="Ticket QR code" className="mx-auto w-64 rounded-xl bg-white p-2" data-testid="ticket-qr" />
        <p className="mt-4 font-medium">{pass.fullName}</p>
        <p className="text-neutral-300">{passTitle(pass)}</p>
        <p className="text-sm text-neutral-400">{passWhen(pass, pass.gym.timezone)}</p>
        <p className="mt-4 text-sm text-neutral-500">One-time ticket. Show this at the front desk — it works once.</p>
      </>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-6 py-12 text-center text-white">
      {valid && (pass?.gym ?? booking?.gym) && <p className="mb-6 text-sm text-neutral-400">{(pass?.gym ?? booking!.gym).name}</p>}
      {body}
    </main>
  );
}
