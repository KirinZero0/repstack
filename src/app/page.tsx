import BrandMark from "@/components/BrandMark";
import HeroLedger from "@/components/landing/HeroLedger";
import Pricing, { type Tier } from "@/components/landing/Pricing";
import { prisma } from "@/lib/prisma";
import GymSlugForm from "./GymSlugForm";

export const dynamic = "force-dynamic";

async function loadTiers(): Promise<Tier[]> {
  try {
    const plans = await prisma.saasPlan.findMany({ where: { isActive: true } });
    const byTier = new Map<string, Tier>();
    for (const p of plans) {
      const name = p.name.replace(/\s+(monthly|annual|yearly)$/i, "");
      const tier =
        byTier.get(name) ??
        ({ name, monthly: 0, annual: null, maxMembers: p.maxMembers, maxStaff: p.maxStaff, maxWhatsappPerMonth: p.maxWhatsappPerMonth, customBranding: p.customBranding } as Tier);
      if (p.billingInterval === "annual") tier.annual = Number(p.price);
      else tier.monthly = Number(p.price);
      byTier.set(name, tier);
    }
    return Array.from(byTier.values())
      .filter((t) => t.monthly > 0)
      .sort((a, b) => a.monthly - b.monthly);
  } catch (err) {
    console.error("Failed to load plans for landing page", err);
    return [];
  }
}

const steps = [
  {
    title: "Add the member",
    body: "Enter a name, phone number and plan. They get an activation link and an invoice on WhatsApp.",
  },
  {
    title: "They pay and activate",
    body: "Paying the invoice switches their membership on. They set a password and add a photo.",
  },
  {
    title: "They scan at the door",
    body: "Print your gym's QR poster once. Members scan it with their own phone, so nobody has to mind a webcam.",
  },
];

const features = [
  {
    title: "Check-in without a front desk",
    body: "One visit per member per day. Expired or frozen memberships get a red screen. Staff can still scan a member's own QR if a phone dies.",
  },
  {
    title: "Billing that chases itself",
    body: "Members get a WhatsApp reminder three days before they expire, and lapsed memberships are flagged for you automatically.",
  },
  {
    title: "Numbers you can read",
    body: "Revenue by month and plan, unpaid invoices, and every member's attendance streak, without exporting a spreadsheet.",
  },
  {
    title: "Your gym's data stays yours",
    body: "Every query is scoped to your gym. Member phone numbers are encrypted, and only masked digits appear in lists.",
  },
];

const faqs = [
  {
    q: "Who pays whom?",
    a: "Your members pay you for their memberships. Iron Ledger bills you separately, monthly or yearly, for the software.",
  },
  {
    q: "What do my members need?",
    a: "A phone with a camera and WhatsApp. They log in with an email and password, and open their QR code or scan your poster.",
  },
  {
    q: "Do I need my own WhatsApp number?",
    a: "Yes. Messages go out from a Fonnte or Wablas number connected to your gym, and we set that up with you.",
  },
  {
    q: "What if a member forgets their password at the door?",
    a: "Send them a one-time QR link over WhatsApp from their member page, or scan their QR yourself from the staff scanner.",
  },
];

export default async function Home() {
  const tiers = await loadTiers();
  const contactUrl = process.env.NEXT_PUBLIC_CONTACT_URL || "#login";

  return (
    <div className="bg-neutral-950 text-white">
      <header className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <BrandMark />
          <nav className="flex items-center gap-6 text-sm text-neutral-300">
            <a href="#how" className="hidden hover:text-white sm:inline">How it works</a>
            <a href="/demo" className="hidden hover:text-white sm:inline">Demo</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <a href="#faq" className="hidden hover:text-white sm:inline">FAQ</a>
            <a href="#login" className="rounded-full bg-white px-4 py-1.5 font-medium text-neutral-950 hover:bg-neutral-200">
              Log in
            </a>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:pt-24">
          <div>
            <h1 className="max-w-xl text-5xl font-semibold leading-[1.02] sm:text-6xl">
              Know who trained. Know who paid.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-neutral-400">
              Iron Ledger runs memberships, door check-ins and billing for independent gyms. Members
              scan a poster to check in, and invoices go out over WhatsApp.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href={contactUrl} className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
                Set up my gym
              </a>
              <a href="/demo" className="rounded-lg border border-neutral-700 px-6 py-3 text-sm font-semibold text-white hover:bg-neutral-900">
                Try the demo
              </a>
            </div>
          </div>
          <HeroLedger />
        </section>

        {/* How it works: a real sequence, so the steps are numbered */}
        <section id="how" className="scroll-mt-16 border-t border-neutral-800 bg-neutral-900/40">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <h2 className="max-w-md text-3xl font-semibold sm:text-4xl">From sign-up to first workout</h2>
            <ol className="mt-14 grid gap-10 md:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s.title} className="flex gap-5">
                  <span className="font-display text-5xl font-semibold leading-none text-plate-yellow">{i + 1}</span>
                  <div>
                    <h3 className="text-lg font-semibold">{s.title}</h3>
                    <p className="mt-2 max-w-xs leading-relaxed text-neutral-400">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features as ruled rows, ledger-style, not cards */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="max-w-lg text-3xl font-semibold sm:text-4xl">Built for how gyms actually run</h2>
          <dl className="mt-12 border-t border-neutral-700">
            {features.map((f) => (
              <div key={f.title} className="grid gap-2 border-b border-neutral-800 py-7 md:grid-cols-[0.8fr_1.2fr] md:gap-10">
                <dt className="font-display text-xl font-semibold">{f.title}</dt>
                <dd className="max-w-xl leading-relaxed text-neutral-400">{f.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-16 border-t border-neutral-800 bg-neutral-900/40">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <h2 className="max-w-md text-3xl font-semibold sm:text-4xl">Pricing that scales with your floor</h2>
            <p className="mb-10 mt-4 max-w-lg text-neutral-400">
              Every plan includes check-in, billing and dashboards. Pick the size that fits your
              member count.
            </p>
            {tiers.length > 0 ? (
              <Pricing tiers={tiers} contactUrl={contactUrl} />
            ) : (
              <p className="text-neutral-400">Plans are being updated. Check back shortly.</p>
            )}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-16 mx-auto max-w-3xl px-6 py-24">
          <h2 className="text-3xl font-semibold sm:text-4xl">Questions gym owners ask</h2>
          <div className="mt-10 divide-y divide-neutral-800 border-y border-neutral-800">
            {faqs.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {f.q}
                  <span className="text-xl text-neutral-500 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="mt-3 max-w-xl leading-relaxed text-neutral-400">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Log in */}
        <section id="login" className="scroll-mt-16 border-t border-neutral-800 bg-neutral-900/40">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-24 md:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold sm:text-4xl">Already on Iron Ledger?</h2>
              <p className="mt-4 max-w-sm text-neutral-400">
                Enter your gym&apos;s short name (the part after /g/ in your link) to log in as staff or as a member.
              </p>
            </div>
            <div className="max-w-sm">
              <GymSlugForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-neutral-500">
          <BrandMark />
          <a href="/superadmin/login" className="hover:text-neutral-300">Platform admin</a>
        </div>
      </footer>
    </div>
  );
}
