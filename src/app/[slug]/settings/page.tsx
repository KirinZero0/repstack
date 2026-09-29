import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { gymThemeFromSettings } from "@/lib/theme";
import { Card } from "@/components/charts";
import { GymDetailsForm, GymThemeForm, JoinSettingsForm, BankDetailsForm, OnlinePaymentsForm, GymProfileForm } from "@/components/SettingsForms";
import GymPhotosManager from "@/components/GymPhotosManager";
import { gymAcceptsSignups } from "@/lib/memberSignup";
import { gymPaymentsEnabled, onlinePaymentsEnabled } from "@/lib/gateway";
import { MAX_GYM_PHOTOS } from "@/lib/validation/tenant";
import GymNav from "@/components/GymNav";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = { SENT: "text-emerald-400", FAILED: "text-red-400", SKIPPED: "text-amber-400", LIMIT: "text-amber-400" };

export default async function GymSettingsPage({ params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  if (session.role !== "OWNER") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">403 — Only the gym owner can change settings.</p>
      </main>
    );
  }

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [plan, used, recent] = await Promise.all([
    db.saasPlan.findUnique({ where: { id: gym.saasPlanId } }),
    db.notificationLog.count({ where: { gymId: gym.id, channel: "whatsapp", status: "SENT", sentAt: { gte: monthStart } } }),
    db.notificationLog.findMany({ where: { gymId: gym.id }, orderBy: { sentAt: "desc" }, take: 5 }),
  ]);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Settings</h1>
            <p className="text-sm text-neutral-400">{gym.name}</p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="settings" />
        </div>

        <div className="mb-6">
          <Card title="Gym details">
            <GymDetailsForm slug={params.slug} initialName={gym.name} initialTimezone={gym.timezone} />
          </Card>
        </div>

        <div className="mb-6">
          <Card title="Public page">
            <GymProfileForm
              slug={params.slug}
              initial={{ description: gym.description ?? "", address: gym.address ?? "" }}
              publicUrl={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/${params.slug}`}
            />
          </Card>
        </div>

        <div className="mb-6">
          <Card title="Gym photos">
            <GymPhotosManager slug={params.slug} photos={gym.photoUrls} max={MAX_GYM_PHOTOS} />
          </Card>
        </div>

        <div className="mb-6">
          <Card title="WhatsApp messages">
            <p className="mb-4 text-sm text-neutral-400">
              Activation links, payment receipts and expiry reminders are sent to your members by Repstack, with your gym&apos;s name on each message. Nothing to set up.
            </p>
            {plan && (
              <p className="text-sm text-neutral-300">
                <span className="font-semibold tabular-nums">{used.toLocaleString("id-ID")}</span> of{" "}
                <span className="tabular-nums">{plan.maxWhatsappPerMonth.toLocaleString("id-ID")}</span> messages used this month.
                {used >= plan.maxWhatsappPerMonth && <span className="ml-1 text-amber-400">Limit reached: further messages aren&apos;t sent until next month or an upgrade.</span>}
              </p>
            )}
            {recent.length > 0 && (
              <div className="mt-6 border-t border-neutral-800 pt-4">
                <p className="mb-2 text-sm text-neutral-400">Latest messages</p>
                <ul className="space-y-1 text-sm">
                  {recent.map((n) => (
                    <li key={n.id} className="flex flex-wrap justify-between gap-x-4">
                      <span className="text-neutral-300">{n.type.replace(/_/g, " ")}</span>
                      <span className="flex gap-3">
                        <span className={STATUS_TONE[n.status] ?? "text-neutral-400"}>
                          {n.status === "SKIPPED" ? "Not sent (WhatsApp unavailable)" : n.status === "LIMIT" ? "Not sent (monthly limit reached)" : n.status.toLowerCase()}
                        </span>
                        <span className="text-neutral-500">{n.sentAt.toLocaleString("id-ID")}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>

        <div className="mb-6">
          <Card title="Bank transfer details">
            <BankDetailsForm
              slug={params.slug}
              initial={{
                bankName: gym.bankName ?? "",
                bankAccountNumber: gym.bankAccountNumber ?? "",
                bankAccountHolder: gym.bankAccountHolder ?? "",
              }}
            />
          </Card>
        </div>

        <div className="mb-6">
          <Card title="Online payments">
            <OnlinePaymentsForm slug={params.slug} initial={gymPaymentsEnabled(gym.settings)} providerReady={onlinePaymentsEnabled()} />
          </Card>
        </div>

        <div className="mb-6">
          <Card title="Online sign-up">
            <JoinSettingsForm
              slug={params.slug}
              initial={gymAcceptsSignups(gym.settings)}
              joinUrl={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/${params.slug}/join`}
            />
          </Card>
        </div>

        <Card title="Appearance">
          <GymThemeForm slug={params.slug} initial={gymThemeFromSettings(gym.settings) ?? "inherit"} />
        </Card>
      </div>
    </main>
  );
}
