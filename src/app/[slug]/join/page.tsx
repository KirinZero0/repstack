import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { gymAcceptsSignups } from "@/lib/memberSignup";
import JoinForm from "./JoinForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug }, select: { name: true } }).catch(() => null);
  return { title: gym ? `Join ${gym.name}` : "Join a gym" };
}

export default async function JoinPage({ params }: { params: { slug: string } }) {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) notFound();

  const open =
    gymAcceptsSignups(gym.settings) && gym.subscriptionStatus !== "SUSPENDED" && gym.subscriptionStatus !== "CANCELLED";
  const plans = open
    ? await prisma.membershipPlan.findMany({ where: { gymId: gym.id, isActive: true }, orderBy: { price: "asc" } })
    : [];

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-neutral-400">{gym.name}</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Become a member</h1>

        {!open || plans.length === 0 ? (
          <div className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-neutral-300">
              {gym.name} isn&apos;t taking online sign-ups right now. Please ask at the front desk to join.
            </p>
            <a href={`/${params.slug}/login`} className="mt-4 inline-block text-sm text-neutral-400 underline underline-offset-2 hover:text-white">
              Already a member? Log in
            </a>
          </div>
        ) : (
          <>
            <p className="mt-3 max-w-md text-neutral-400">
              Choose a plan, create your login, then transfer your membership fee to the gym&apos;s account below. Staff
              confirms the payment and activates your membership.
            </p>
            <div className="mt-10">
              <JoinForm
                slug={params.slug}
                plans={plans.map((p) => ({ id: p.id, name: p.name, price: Number(p.price), days: p.durationDays }))}
                bank={
                  gym.bankName && gym.bankAccountNumber
                    ? { bankName: gym.bankName, accountNumber: gym.bankAccountNumber, accountHolder: gym.bankAccountHolder ?? "" }
                    : null
                }
              />
            </div>
            <a href={`/${params.slug}/login`} className="mt-8 inline-block text-sm text-neutral-500 hover:text-neutral-300">
              Already a member? Log in
            </a>
          </>
        )}
      </div>
    </main>
  );
}
