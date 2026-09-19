"use client";

import { useState } from "react";
import { PlateGlyph } from "../BrandMark";

export interface Tier {
  name: string;
  monthly: number;
  annual: number | null;
  maxMembers: number;
  maxStaff: number;
  maxWhatsappPerMonth: number;
  customBranding: boolean;
}

const PLATES = ["var(--plate-green)", "var(--plate-blue)", "var(--plate-red)", "var(--plate-yellow)"];
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export default function Pricing({ tiers, contactUrl }: { tiers: Tier[]; contactUrl: string }) {
  const [yearly, setYearly] = useState(false);
  const hasAnnual = tiers.some((t) => t.annual !== null);
  const free = tiers.find((t) => t.annual)
    ? Math.round(12 - (tiers.find((t) => t.annual)!.annual as number) / tiers.find((t) => t.annual)!.monthly)
    : 0;

  return (
    <div>
      {hasAnnual && (
        <div className="mb-10 flex flex-wrap items-center gap-4">
          <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-neutral-700 bg-neutral-900 p-1 text-sm">
            {[
              { label: "Monthly", value: false },
              { label: "Yearly", value: true },
            ].map((o) => (
              <button
                key={o.label}
                role="radio"
                aria-checked={yearly === o.value}
                onClick={() => setYearly(o.value)}
                className={`rounded-full px-5 py-1.5 font-medium transition-colors ${
                  yearly === o.value ? "bg-white text-neutral-950" : "text-neutral-400 hover:text-white"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {free > 0 && <span className="text-sm text-neutral-400">Pay yearly and get {free} months free.</span>}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-3">
        {tiers.map((t, i) => {
          const showYearly = yearly && t.annual !== null;
          const color = PLATES[i % PLATES.length];
          return (
            <article
              key={t.name}
              className="relative flex flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 p-7"
              style={{ boxShadow: `inset 0 3px 0 0 ${color}` }}
            >
              <div className="mb-6 flex items-center gap-3">
                <PlateGlyph size={30} color={color} />
                <h3 className="font-display text-xl font-semibold text-white">{t.name}</h3>
              </div>

              <p className="whitespace-nowrap font-display text-[2rem] font-semibold tracking-tight text-white tabular-nums">
                {rp(showYearly ? t.annual! / 12 : t.monthly)}
                <span className="ml-1 text-sm font-normal text-neutral-400">/ month</span>
              </p>
              <p className="mt-1 h-5 text-sm text-neutral-400">
                {showYearly ? `${rp(t.annual!)} billed once a year` : "Billed monthly"}
              </p>

              <ul className="mt-7 flex-1 space-y-3 text-sm text-neutral-300">
                <li>Up to {t.maxMembers.toLocaleString("id-ID")} members</li>
                <li>{t.maxStaff} staff accounts</li>
                <li>{t.maxWhatsappPerMonth.toLocaleString("id-ID")} WhatsApp messages a month</li>
                <li>QR check-in, invoices and dashboards</li>
                {t.customBranding && <li>Your own branding</li>}
              </ul>

              <a
                href={contactUrl}
                className="mt-8 rounded-lg bg-white px-4 py-2.5 text-center text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200"
              >
                Start with {t.name}
              </a>
            </article>
          );
        })}
      </div>
    </div>
  );
}
