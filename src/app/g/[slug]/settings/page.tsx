import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { gymThemeFromSettings } from "@/lib/theme";
import { Card } from "@/components/charts";
import { GymThemeForm } from "@/components/SettingsForms";

export const dynamic = "force-dynamic";

export default async function GymSettingsPage({ params }: { params: { slug: string } }) {
  let session, gym;
  try {
    ({ session, gym } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/g/${params.slug}/login`);
    throw err;
  }

  if (session.role !== "OWNER") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">403 — Only the gym owner can change settings.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Settings</h1>
            <p className="text-sm text-neutral-400">{gym.name}</p>
          </div>
          <a href={`/g/${params.slug}/dashboard`} className="text-sm text-neutral-300 hover:text-white">
            ← Dashboard
          </a>
        </div>
        <Card title="Appearance">
          <GymThemeForm slug={params.slug} initial={gymThemeFromSettings(gym.settings) ?? "inherit"} />
        </Card>
      </div>
    </main>
  );
}
