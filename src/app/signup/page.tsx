import { redirect } from "next/navigation";
import type { Metadata } from "next";
import BrandMark from "@/components/BrandMark";
import { prisma } from "@/lib/prisma";
import { isMockMode, onlinePaymentsEnabled } from "@/lib/gateway";
import SignupForm from "./SignupForm";

export const metadata: Metadata = { title: "Set up your gym · Repstack" };
export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: { plan?: string } }) {
  const plan = searchParams.plan
    ? await prisma.saasPlan.findFirst({ where: { id: searchParams.plan, isActive: true } }).catch(() => null)
    : null;
  if (!plan) redirect("/#pricing");

  const tier = plan.name.replace(/\s+(monthly|annual|yearly)$/i, "");
  const yearly = plan.billingInterval === "annual";
  const price = Number(plan.price);

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <BrandMark />
          <a href="/#pricing" className="text-sm text-neutral-400 hover:text-white">← Back to pricing</a>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-12 px-6 py-14 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <h1 className="text-3xl font-semibold sm:text-4xl">Set up your gym</h1>
          <p className="mt-3 max-w-md text-neutral-400">
            Create your owner account, pay for your plan, and your gym is ready to log in to straight away.
          </p>
          <div className="mt-10">
            {onlinePaymentsEnabled() || isMockMode() ? (
              <SignupForm planId={plan.id} />
            ) : (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
                <p className="text-neutral-300">Self-serve sign-up is currently unavailable. Please contact us to set up your gym.</p>
              </div>
            )}
          </div>
        </div>

        <aside className="h-fit rounded-2xl border border-neutral-800 bg-neutral-900 p-6 lg:mt-24">
          <p className="text-sm text-neutral-400">Your plan</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{tier}</h2>
          <p className="mt-4 font-display text-3xl font-semibold tabular-nums">
            Rp {price.toLocaleString("id-ID")}
            <span className="ml-1 text-sm font-normal text-neutral-400">{yearly ? "/ year" : "/ month"}</span>
          </p>
          <p className="mt-1 text-sm text-neutral-400">{yearly ? "Billed once a year" : "Billed every month"}</p>
          <ul className="mt-6 space-y-2 text-sm text-neutral-300">
            <li>Up to {plan.maxMembers.toLocaleString("id-ID")} members</li>
            <li>{plan.maxStaff} staff accounts</li>
            <li>{plan.maxWhatsappPerMonth.toLocaleString("id-ID")} WhatsApp messages a month</li>
            <li>QR check-in, invoices and dashboards</li>
            {plan.customBranding && <li>Your own branding</li>}
          </ul>
          <p className="mt-6 border-t border-neutral-800 pt-4 text-xs text-neutral-500">
            You&apos;ll pay on a secure payment page by bank transfer, e-wallet or card. Your gym is created as soon as the payment clears.
          </p>
        </aside>
      </div>
    </main>
  );
}
