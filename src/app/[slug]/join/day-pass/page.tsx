import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { dayKeyInTimezone } from "@/lib/date";
import { DAY_PASS_MAX_DAYS_AHEAD } from "@/lib/validation/tenant";
import DayPassForm from "./DayPassForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug }, select: { name: true } }).catch(() => null);
  return { title: gym ? `Day pass at ${gym.name}` : "Day pass" };
}

/** Public: a visitor who doesn't want a membership asks for a one-visit day pass. Staff approve before any ticket exists. */
export default async function DayPassPage({ params }: { params: { slug: string } }) {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) notFound();

  const open = gym.subscriptionStatus !== "SUSPENDED" && gym.subscriptionStatus !== "CANCELLED";
  const plans = open ? await prisma.dayPassPlan.findMany({ where: { gymId: gym.id, isActive: true }, orderBy: { price: "asc" } }) : [];
  const now = Date.now();

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-neutral-400">{gym.name}</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Get a day pass</h1>
        {plans.length === 0 ? (
          <p className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-300">
            {gym.name} isn&apos;t offering day passes right now. Please ask at the front desk.
          </p>
        ) : (
          <>
            <p className="mt-3 max-w-md text-neutral-400">
              Just visiting? No membership needed. Ask for a day pass; once the gym approves, you get a one-time QR ticket on WhatsApp.
            </p>
            <div className="mt-10">
              <DayPassForm
                slug={params.slug}
                plans={plans.map((p) => ({ id: p.id, name: p.name, price: Number(p.price) }))}
                dateRange={{
                  min: dayKeyInTimezone(new Date(now), gym.timezone),
                  max: dayKeyInTimezone(new Date(now + DAY_PASS_MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000), gym.timezone),
                }}
              />
            </div>
          </>
        )}
        <a href={`/${params.slug}/join`} className="mt-8 inline-block text-sm text-neutral-500 hover:text-neutral-300">← Join {gym.name}</a>
      </div>
    </main>
  );
}
