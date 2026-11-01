import { redirect } from "next/navigation";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { getPlatformTheme } from "@/lib/theme";
import { Card } from "@/components/charts";
import { getPlatformBank } from "@/lib/platformBank";
import { PlatformSettingsForm, PlatformBankForm } from "@/components/SettingsForms";
import { getLandingTiers } from "@/lib/landingPlans";
import RefreshPlansButton from "./RefreshPlansButton";

export const dynamic = "force-dynamic";

export default async function SuperadminSettingsPage() {
  try {
    await requireSuperadminSession();
  } catch (err) {
    if (err instanceof SessionError) redirect("/superadmin/login");
    throw err;
  }
  const t = await getPlatformTheme();
  const bank = await getPlatformBank();
  // What the landing page is showing right now: the cached copy, not a fresh read.
  const tiers = await getLandingTiers().catch(() => null);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Platform settings</h1>
          <nav className="flex gap-4 text-sm">
            <a href="/superadmin/dashboard" className="text-neutral-300 hover:text-white">Dashboard</a>
            <a href="/superadmin/gyms" className="text-neutral-300 hover:text-white">Gyms</a>
            <a href="/superadmin/invoices" className="text-neutral-300 hover:text-white">Invoices</a>
          </nav>
        </div>
        <Card title="Bank account for subscriptions">
          <PlatformBankForm initial={bank} />
          <p className="mt-4 text-xs text-neutral-500">
            Shown to gym owners when they pay their Liftmora subscription by bank transfer, until online payments are switched on.
            You confirm each transfer from Gyms.
          </p>
        </Card>
        <div className="h-6" />
        <Card title="Landing page prices">
          <p className="mb-3 text-xs text-neutral-500">
            The landing page keeps a copy of the plan prices so visitors never wake the database. After changing a plan in the
            database, refresh it here.
          </p>
          {tiers === null ? (
            <p className="mb-3 text-sm text-red-400">Couldn&apos;t load the plans.</p>
          ) : (
            <ul className="mb-4 space-y-1 text-sm text-neutral-300" data-testid="landing-tiers">
              {tiers.map((t) => (
                <li key={t.name} className="flex justify-between gap-4">
                  <span>{t.name}</span>
                  <span className="tabular-nums text-neutral-400">
                    Rp {t.monthly.toLocaleString("id-ID")} / month{t.annual ? ` · Rp ${t.annual.toLocaleString("id-ID")} / year` : ""}
                  </span>
                </li>
              ))}
              {tiers.length === 0 && <li className="text-neutral-500">No active plans.</li>}
            </ul>
          )}
          <RefreshPlansButton />
        </Card>
        <div className="h-6" />
        <Card title="Appearance">
          <PlatformSettingsForm initialMode={t.mode} initialOverride={t.allowUserOverride} />
          <p className="mt-4 text-xs text-neutral-500">
            Stored in the AppConfig table. A gym&apos;s own setting overrides this for its staff and
            members; a user&apos;s toggle overrides both (when allowed).
          </p>
        </Card>
      </div>
    </main>
  );
}
