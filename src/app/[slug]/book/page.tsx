import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { gymBank } from "@/lib/transferProof";
import { dayKeyInTimezone } from "@/lib/date";
import { MAX_DAYS_AHEAD } from "@/lib/fieldBooking";
import BookingForm from "./BookingForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug }, select: { name: true } }).catch(() => null);
  return { title: gym ? `Book a field at ${gym.name}` : "Book a field" };
}

/** Public: pick a field, a day and a stretch of time. Staff approve it; only then is the time yours. */
export default async function BookPage({ params }: { params: { slug: string } }) {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) notFound();

  const open = gym.subscriptionStatus !== "SUSPENDED" && gym.subscriptionStatus !== "CANCELLED";
  const fields = open ? await prisma.field.findMany({ where: { gymId: gym.id, isActive: true }, orderBy: { name: "asc" } }) : [];
  const today = dayKeyInTimezone(new Date(), gym.timezone);
  const last = dayKeyInTimezone(new Date(Date.now() + MAX_DAYS_AHEAD * 24 * 3600 * 1000), gym.timezone);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-neutral-400">{gym.name}</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Book a field</h1>
        {fields.length === 0 ? (
          <p className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-300">
            There are no fields open for booking right now. Please ask at the front desk.
          </p>
        ) : (
          <>
            <p className="mt-3 max-w-md text-neutral-400">
              Pick a field, a day and the hours you want. The gym confirms your booking, and the time is yours once it does. Your ticket then arrives by email and on WhatsApp.
            </p>
            <div className="mt-10">
              <BookingForm
                slug={params.slug}
                bank={gymBank(gym)}
                today={today}
                last={last}
                fields={fields.map((f) => ({
                  id: f.id,
                  name: f.name,
                  sport: f.sport,
                  pricePerHour: Number(f.pricePerHour),
                  opensAt: f.opensAt,
                  closesAt: f.closesAt,
                  stepMinutes: f.stepMinutes,
                }))}
              />
            </div>
          </>
        )}
        <a href={`/${params.slug}`} className="mt-8 inline-block text-sm text-neutral-500 hover:text-neutral-300">← {gym.name}</a>
      </div>
    </main>
  );
}
