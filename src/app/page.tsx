import HeroLedger from "@/components/landing/HeroLedger";
import Pricing, { type Tier } from "@/components/landing/Pricing";
import { SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { FEATURE_GROUPS } from "@/components/landing/features";
import { PlateGlyph } from "@/components/BrandMark";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function loadTiers(): Promise<Tier[]> {
  try {
    const plans = await prisma.saasPlan.findMany({ where: { isActive: true } });
    const byTier = new Map<string, Tier>();
    for (const p of plans) {
      const name = p.name.replace(/\s+(monthly|annual|yearly)$/i, "");
      const tier =
        byTier.get(name) ??
        ({ name, monthly: 0, annual: null, monthlyId: "", annualId: null, maxMembers: p.maxMembers, maxStaff: p.maxStaff, maxWhatsappPerMonth: p.maxWhatsappPerMonth, customBranding: p.customBranding } as Tier);
      if (p.billingInterval === "annual") {
        tier.annual = Number(p.price);
        tier.annualId = p.id;
      } else {
        tier.monthly = Number(p.price);
        tier.monthlyId = p.id;
      }
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
    title: "Bring your members over",
    body: "Import the spreadsheet you already keep, or add people one at a time. Each member gets a WhatsApp link to set a password and see their QR.",
  },
  {
    title: "They pay the way they already do",
    body: "Record cash at the desk, or let members transfer to your bank account and send the proof from their phone. Switch on online payments when you are ready.",
  },
  {
    title: "They scan at the door",
    body: "Print your gym's QR poster once. Members scan it with their own phone; you see who is in, who is due, and who stopped coming.",
  },
];

const PLATE: Record<string, string> = {
  yellow: "var(--plate-yellow)",
  green: "var(--plate-green)",
  blue: "var(--plate-blue)",
  red: "var(--plate-red)",
};

/** The groups the home page summarises; the rest live on /features. */
const HOME_GROUPS = ["members", "checkin", "payments", "classes", "finance", "member-app"];

const faqs = [
  {
    q: "Who pays whom?",
    a: "Your members pay you for their memberships, by cash, bank transfer or online. Liftmora bills you separately, monthly or yearly, for the software.",
  },
  {
    q: "What do my members need?",
    a: "A phone with a camera and WhatsApp. They log in with an email and password, and open their QR code or scan your poster. Nothing to install.",
  },
  {
    q: "Do I need my own WhatsApp number?",
    a: "No. Messages go out from day one within your plan's monthly allowance. Connect your own Fonnte number in Settings whenever you like and the cap goes away.",
  },
  {
    q: "We have 80 members in a spreadsheet. How long does switching take?",
    a: "An afternoon. Export your sheet as CSV, upload it, check the preview, import. Each member gets their activation link, or you can send links later if you'd rather tell them first.",
  },
  {
    q: "What if a member forgets their password at the door?",
    a: "Send a one-time QR link over WhatsApp from their member page, or scan their QR yourself from the staff scanner.",
  },
  {
    q: "What happens to my data if I stop?",
    a: "Your account is suspended, not deleted, and you can export your members and finances as CSV at any time before or after.",
  },
];

export default async function Home() {
  const tiers = await loadTiers();
  const groups = HOME_GROUPS.map((id) => FEATURE_GROUPS.find((g) => g.id === id)!);

  return (
    <div className="bg-neutral-950 text-white">
      <SiteHeader current="home" />

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:pt-24">
          <div>
            <h1 className="max-w-xl text-5xl font-semibold leading-[1.02] sm:text-6xl">
              Know who trained. Know who paid.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-neutral-400">
              Liftmora runs memberships, door check-ins, payments and classes for independent gyms.
              Members scan a poster to check in and renew from their phone. You see everything from one dashboard.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href="#pricing" className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
                Set up my gym
              </a>
              <a href="/demo" className="rounded-lg border border-neutral-700 px-6 py-3 text-sm font-semibold text-white hover:bg-neutral-900">
                Try the demo
              </a>
            </div>
            <p className="mt-6 text-sm text-neutral-500">No setup fee. No app to install. Cancel any time and take your data with you.</p>
          </div>
          <HeroLedger />
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-16 border-t border-neutral-800 bg-neutral-900/40">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <h2 className="max-w-md text-3xl font-semibold sm:text-4xl">From your spreadsheet to the first scan</h2>
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

        {/* Features: six groups, three lines each, with the full catalogue a click away */}
        <section id="features" className="scroll-mt-16 mx-auto max-w-6xl px-6 py-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="max-w-lg text-3xl font-semibold sm:text-4xl">Built for how gyms actually run</h2>
            <a href="/features" className="text-sm font-medium text-neutral-300 underline-offset-4 hover:text-white hover:underline">
              See every feature →
            </a>
          </div>
          <div className="mt-12 grid gap-x-12 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <div key={g.id} className="border-t border-neutral-700 pt-5">
                <div className="flex items-center gap-2.5">
                  <PlateGlyph size={22} color={PLATE[g.color]} />
                  <h3 className="font-display text-xl font-semibold">{g.title}</h3>
                </div>
                <p className="mt-2 text-sm text-neutral-500">{g.lede}</p>
                <ul className="mt-4 space-y-2.5 text-[15px] leading-relaxed text-neutral-300">
                  {g.items.slice(0, 3).map((f) => (
                    <li key={f.title} className="flex gap-2.5">
                      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-600" aria-hidden="true" />
                      <span>{f.title}</span>
                    </li>
                  ))}
                </ul>
                <a href={`/features#${g.id}`} className="mt-4 inline-block text-sm text-neutral-500 hover:text-white">
                  More about {g.title.toLowerCase()} →
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* Security strip */}
        <section className="border-t border-neutral-800 bg-neutral-900/40">
          <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-3">
            {[
              { title: "Each gym is sealed off", body: "Scoped in the app, enforced again by the database. One gym can never see another." },
              { title: "Encrypted where it matters", body: "Member phone numbers and WhatsApp credentials are encrypted at rest. Lists show masked digits." },
              { title: "Your data is yours", body: "Export members and finances as CSV any time. Erase a member on request. Leave whenever you like." },
            ].map((s) => (
              <div key={s.title}>
                <h3 className="font-display text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-400">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-16 border-t border-neutral-800">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <h2 className="max-w-md text-3xl font-semibold sm:text-4xl">Pricing that scales with your floor</h2>
            <p className="mb-10 mt-4 max-w-lg text-neutral-400">
              Every plan includes everything: check-in, payments, classes, finance and WhatsApp. Pick the size that fits
              your member count. No setup fee.
            </p>
            {tiers.length > 0 ? (
              <Pricing tiers={tiers} />
            ) : (
              <p className="text-neutral-400">Plans are being updated. Check back shortly.</p>
            )}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-16 border-t border-neutral-800 bg-neutral-900/40">
          <div className="mx-auto max-w-3xl px-6 py-24">
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
          </div>
        </section>

        {/* Log in */}
        <section id="login" className="scroll-mt-16 border-t border-neutral-800">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-24 md:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold sm:text-4xl">Already on Liftmora?</h2>
              <p className="mt-4 max-w-sm text-neutral-400">
                One login for staff and members, at any gym. Just your email and password — nothing else to remember.
              </p>
            </div>
            <div className="max-w-sm">
              <a
                href="/login"
                className="block w-full rounded-lg bg-white py-2.5 text-center text-sm font-semibold text-neutral-950 hover:bg-neutral-200"
              >
                Log in
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
