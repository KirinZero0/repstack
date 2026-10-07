import { redirect } from "next/navigation";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { getPlatformTheme } from "@/lib/theme";
import { Card } from "@/components/charts";
import { getPlatformBank } from "@/lib/platformBank";
import { PlatformSettingsForm, PlatformBankForm } from "@/components/SettingsForms";

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

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Platform settings</h1>
          <nav className="flex gap-4 text-sm">
            <a href="/superadmin/dashboard" className="text-neutral-300 hover:text-white">Dashboard</a>
            <a href="/superadmin/gyms" className="text-neutral-300 hover:text-white">Gyms</a>
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
