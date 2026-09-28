"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type GymNavPage = "dashboard" | "members" | "checkin-station" | "checkin" | "staff" | "plans" | "finance" | "billing" | "settings";

interface Props {
  slug: string;
  role: "OWNER" | "STAFF";
  current: GymNavPage;
  /** True while a gym suspended for non-payment lets its owner in to billing only — every other link is hidden. */
  billingOnly?: boolean;
}

interface Item {
  page: GymNavPage;
  label: string;
  href: (slug: string) => string;
  ownerOnly?: boolean;
}

const ITEMS: Item[] = [
  { page: "dashboard", label: "Dashboard", href: (s) => `/${s}/dashboard` },
  { page: "members", label: "Members", href: (s) => `/${s}/members` },
  { page: "checkin-station", label: "Check-in poster", href: (s) => `/${s}/checkin-station` },
  { page: "checkin", label: "Staff scanner", href: (s) => `/${s}/checkin` },
  { page: "staff", label: "Staff", href: (s) => `/${s}/staff`, ownerOnly: true },
  { page: "plans", label: "Plans", href: (s) => `/${s}/plans`, ownerOnly: true },
  { page: "finance", label: "Finance", href: (s) => `/${s}/finance`, ownerOnly: true },
  { page: "billing", label: "Billing", href: (s) => `/${s}/billing`, ownerOnly: true },
  { page: "settings", label: "Settings", href: (s) => `/${s}/settings`, ownerOnly: true },
];

const linkCls = (active: boolean) =>
  `whitespace-nowrap text-sm ${active ? "font-medium text-white" : "text-neutral-300 hover:text-white"}`;

/**
 * The one nav every gym back-office page shares (dashboard, members, staff, plans, finance,
 * billing, settings) — a page used to roll its own header and often left half the links out
 * (e.g. finance only linked back to dashboard). On narrow screens it collapses to a menu button
 * instead of wrapping or getting clipped.
 */
export default function GymNav({ slug, role, current, billingOnly = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const items = billingOnly
    ? ITEMS.filter((i) => i.page === "billing")
    : ITEMS.filter((i) => role === "OWNER" || !i.ownerOnly);

  async function logout() {
    await fetch(`/api/${slug}/staff-logout`, { method: "POST" });
    router.push(`/${slug}/login`);
    router.refresh();
  }

  return (
    <div className="relative shrink-0">
      {/* Desktop / wide screens: the full row, wraps if it has to but never disappears. */}
      <nav className="hidden flex-wrap items-center gap-x-4 gap-y-2 sm:flex" aria-label="Gym navigation">
        {items.map((i) => (
          <a key={i.page} href={i.href(slug)} className={linkCls(i.page === current)}>
            {i.label}
          </a>
        ))}
        <button type="button" onClick={logout} className="text-sm text-neutral-300 hover:text-white">
          Log out
        </button>
      </nav>

      {/* Narrow screens: a menu button opening the same links as a dropdown, so nothing is ever hidden. */}
      <div className="sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Menu"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
        >
          {open ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
            <nav
              className="absolute right-0 top-12 z-50 w-56 space-y-1 rounded-xl border border-neutral-800 bg-neutral-900 p-2 shadow-xl"
              aria-label="Gym navigation"
            >
              {items.map((i) => (
                <a
                  key={i.page}
                  href={i.href(slug)}
                  className={`block rounded-lg px-3 py-2 text-sm ${
                    i.page === current ? "bg-neutral-800 font-medium text-white" : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
                  }`}
                >
                  {i.label}
                </a>
              ))}
              <button
                type="button"
                onClick={logout}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white"
              >
                Log out
              </button>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
