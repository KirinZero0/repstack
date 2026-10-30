import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { Card } from "@/components/charts";
import {
  BankDetailsForm,
  CheckinRulesForm,
  GymDetailsForm,
  GymProfileForm,
  GymThemeForm,
  JoinSettingsForm,
  NotificationsForm,
  OccupancyForm,
  OnlinePaymentsForm,
  SettingsEndpoint,
  WhoIsInForm,
} from "@/components/SettingsForms";
import { GYM_FEATURES, GYM_FEATURE_KEYS, gymFeatures } from "@/config/features";
import { gymThemeFromSettings } from "@/lib/theme";
import { occupancyWindowHours, whoIsInEnabled } from "@/lib/occupancy";
import { checkinRules } from "@/lib/checkin";
import { gymAcceptsSignups } from "@/lib/memberSignup";
import { notificationChannels } from "@/lib/notify";
import { emailConfigured } from "@/lib/email";
import { gymPaymentsEnabled, onlinePaymentsEnabled } from "@/lib/gateway";
import GymFeaturesForm from "./GymFeaturesForm";

export const dynamic = "force-dynamic";

/**
 * A superadmin's view of one gym: the optional features Liftmora grants it, and every setting the owner has on
 * their own Settings page, editable here. Superadmin only; the owner can't reach this page or its routes.
 */
export default async function SuperadminGymPage({ params }: { params: { gymId: string } }) {
  try {
    await requireSuperadminSession();
  } catch (err) {
    if (err instanceof SessionError) redirect("/superadmin/login");
    throw err;
  }

  const gym = await prisma.gym.findUnique({ where: { id: params.gymId }, include: { saasPlan: true } });
  if (!gym) notFound();

  const slug = gym.slug;
  const channels = notificationChannels(gym.settings);
  const enabled = gymFeatures(gym.features);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <a href="/superadmin/gyms" className="text-sm text-neutral-400 hover:text-white">← All gyms</a>
        <div className="mb-8 mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{gym.name}</h1>
            <p className="text-sm text-neutral-400">
              /{gym.slug} · {gym.saasPlan.name} · {gym.subscriptionStatus.toLowerCase().replace("_", " ")}
              {gym.isLifetime ? " · lifetime" : ""}
            </p>
          </div>
          <a href={`/${gym.slug}`} className="text-sm text-neutral-400 underline underline-offset-2 hover:text-white">Public page</a>
        </div>

        <div className="mb-6">
          <Card title="Features">
            <p className="mb-4 text-sm text-neutral-400">
              Optional features Liftmora grants this gym. The owner can&apos;t change these. A feature that is switched off disappears from their menu and stops taking new requests; what already happened stays.
            </p>
            <GymFeaturesForm
              gymId={gym.id}
              features={GYM_FEATURE_KEYS.map((k) => ({ key: k, label: GYM_FEATURES[k].label, description: GYM_FEATURES[k].description, enabled: enabled[k] }))}
            />
          </Card>
        </div>

        <h2 className="mb-3 mt-10 text-lg font-semibold">Gym settings</h2>
        <p className="mb-4 text-sm text-neutral-500">The same settings the owner sees, changed on their behalf. Each change is written to the audit log.</p>
        <SettingsEndpoint url={`/api/superadmin/gyms/${gym.id}/settings`}>
          <div className="space-y-6">
            <Card title="Gym details">
              <GymDetailsForm slug={slug} initialName={gym.name} initialTimezone={gym.timezone} />
            </Card>
            <Card title="Public page">
              <GymProfileForm
                slug={slug}
                initial={{ description: gym.description ?? "", address: gym.address ?? "" }}
                publicUrl={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/${slug}`}
              />
            </Card>
            <Card title="Notifications">
              <NotificationsForm slug={slug} initialWhatsapp={channels.whatsapp} initialEmail={channels.email} emailReady={emailConfigured()} />
            </Card>
            <Card title="Bank transfer details">
              <BankDetailsForm
                slug={slug}
                initial={{ bankName: gym.bankName ?? "", bankAccountNumber: gym.bankAccountNumber ?? "", bankAccountHolder: gym.bankAccountHolder ?? "" }}
              />
            </Card>
            <Card title="Online payments">
              <OnlinePaymentsForm slug={slug} initial={gymPaymentsEnabled(gym.settings)} providerReady={onlinePaymentsEnabled()} />
            </Card>
            <Card title="Online sign-up">
              <JoinSettingsForm slug={slug} initial={gymAcceptsSignups(gym.settings)} joinUrl={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/${slug}/join`} />
            </Card>
            <Card title="Check-ins">
              <CheckinRulesForm slug={slug} initialPerDay={checkinRules(gym.settings).perDay} initialGap={checkinRules(gym.settings).gapMinutes} />
            </Card>
            <Card title="Who's in the gym">
              <OccupancyForm slug={slug} initialHours={occupancyWindowHours(gym.settings)} />
              <div className="mt-4">
                <WhoIsInForm slug={slug} initial={whoIsInEnabled(gym.settings)} />
              </div>
            </Card>
            <Card title="Appearance">
              <GymThemeForm slug={slug} initial={gymThemeFromSettings(gym.settings) ?? "inherit"} />
            </Card>
          </div>
        </SettingsEndpoint>
      </div>
    </main>
  );
}
