import { unstable_cache } from "next/cache";
import { prisma } from "./prisma";
import type { Tier } from "@/components/landing/Pricing";

/** Tag on the cached plan list; `revalidateTag(SAAS_PLANS_TAG)` (the superadmin's Refresh button) clears it. */
export const SAAS_PLANS_TAG = "saas-plans";

/** The active SaaS plans grouped into tiers (monthly + annual price side by side), cheapest first. */
async function loadTiers(): Promise<Tier[]> {
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
}

/**
 * The pricing the landing page shows, cached with no expiry so a visit never touches the database (bots and
 * late-night visitors don't wake Neon). Plans only change by script, so the cache is cleared by hand: the
 * superadmin's "Refresh" button on Platform settings. A failed load isn't cached; the next visit tries again.
 */
export const getLandingTiers = unstable_cache(loadTiers, ["landing-tiers"], { tags: [SAAS_PLANS_TAG] });
