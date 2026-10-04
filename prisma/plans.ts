export interface PlanSeed {
  name: string;
  price: number;
  billingInterval: "monthly" | "annual";
  maxMembers: number;
  maxStaff: number;
  maxWhatsappPerMonth: number;
  customBranding: boolean;
}

// Each tier exists twice (monthly + annual); annual is priced at 10x monthly (two months free).
const tiers = [
  { name: "Solo", monthly: 150_000, maxMembers: 40, maxStaff: 1, wa: 200, branding: false },
  { name: "Starter", monthly: 300_000, maxMembers: 100, maxStaff: 3, wa: 500, branding: false },
  { name: "Growth", monthly: 600_000, maxMembers: 400, maxStaff: 10, wa: 2500, branding: false },
  { name: "Pro", monthly: 1_200_000, maxMembers: 1500, maxStaff: 30, wa: 10000, branding: true },
];

export const PLAN_SEEDS: PlanSeed[] = tiers.flatMap((t) => [
  { name: `${t.name} Monthly`, price: t.monthly, billingInterval: "monthly" as const, maxMembers: t.maxMembers, maxStaff: t.maxStaff, maxWhatsappPerMonth: t.wa, customBranding: t.branding },
  { name: `${t.name} Annual`, price: t.monthly * 10, billingInterval: "annual" as const, maxMembers: t.maxMembers, maxStaff: t.maxStaff, maxWhatsappPerMonth: t.wa, customBranding: t.branding },
]);
