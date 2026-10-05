import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { FEATURE_GROUPS } from "@/components/landing/features";
import { PlateGlyph } from "@/components/BrandMark";

export const metadata: Metadata = {
  title: "Features · Repstack",
  description: "Everything Repstack does for a gym: members, QR check-in, payments and renewals, classes, finance, WhatsApp, the member dashboard, and how your data is protected.",
};

const PLATE: Record<string, string> = {
  yellow: "var(--plate-yellow)",
  green: "var(--plate-green)",
  blue: "var(--plate-blue)",
  red: "var(--plate-red)",
};

/** The whole product, group by group, for an owner who wants to read before they call. */
export default function FeaturesPage() {
  return (
    <div className="bg-neutral-950 text-white">
      <SiteHeader current="features" />

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-14 pt-16 lg:pt-24">
          <p className="text-sm font-medium text-plate-yellow">Everything Repstack does</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold leading-[1.05] sm:text-5xl">
            One system for the door, the money and the members.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-neutral-400">
            Repstack replaces the WhatsApp group, the spreadsheet and the paper logbook. Here is every part of it,
            in the order a gym meets it.
          </p>
          <nav aria-label="Feature groups" className="mt-10 flex flex-wrap gap-2 text-sm">
            {FEATURE_GROUPS.map((g) => (
              <a
                key={g.id}
                href={`#${g.id}`}
                className="rounded-full border border-neutral-700 px-3 py-1.5 text-neutral-300 hover:border-neutral-500 hover:text-white"
              >
                {g.title}
              </a>
            ))}
          </nav>
        </section>

        {FEATURE_GROUPS.map((g, gi) => (
          <section
            key={g.id}
            id={g.id}
            className={`scroll-mt-20 border-t border-neutral-800 ${gi % 2 === 1 ? "bg-neutral-900/40" : ""}`}
          >
            <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="lg:sticky lg:top-24 lg:self-start">
                <div className="flex items-center gap-3">
                  <PlateGlyph size={30} color={PLATE[g.color]} />
                  <h2 className="text-3xl font-semibold">{g.title}</h2>
                </div>
                <p className="mt-4 max-w-sm text-lg leading-relaxed text-neutral-400">{g.lede}</p>
              </div>
              <dl className="border-t border-neutral-700">
                {g.items.map((f) => (
                  <div key={f.title} className="border-b border-neutral-800 py-6">
                    <dt className="font-display text-xl font-semibold">{f.title}</dt>
                    <dd className="mt-2 max-w-2xl leading-relaxed text-neutral-400">{f.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        ))}

        <section className="border-t border-neutral-800">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-20">
            <div>
              <h2 className="text-3xl font-semibold sm:text-4xl">See it with your own members in it</h2>
              <p className="mt-3 max-w-md text-neutral-400">
                Try the demo in your browser, or pick a plan and we set your gym up this week, including importing
                your current member list.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href="/#pricing" className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
                See pricing
              </a>
              <a href="/demo" className="rounded-lg border border-neutral-700 px-6 py-3 text-sm font-semibold text-white hover:bg-neutral-900">
                Try the demo
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
