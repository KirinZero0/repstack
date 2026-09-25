import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { gymThemeFromSettings } from "@/lib/theme";
import { Card } from "@/components/charts";
import { GymThemeForm, JoinSettingsForm } from "@/components/SettingsForms";
import WhatsappForm from "@/components/WhatsappForm";
import { gymAcceptsSignups } from "@/lib/memberSignup";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = { SENT: "text-emerald-400", FAILED: "text-red-400", SKIPPED: "text-amber-400" };

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

  const [wa, owner, recent] = await Promise.all([
    prisma.whatsappSenderConfig.findUnique({ where: { gymId: gym.id } }),
    prisma.staffUser.findUnique({ where: { id: session.staffUserId }, select: { phone: true } }),
    prisma.notificationLog.findMany({ where: { gymId: gym.id }, orderBy: { sentAt: "desc" }, take: 5 }),
  ]);

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

        <div className="mb-6">
          <Card title="WhatsApp messages">
            <p className="mb-4 text-sm text-neutral-400">
              Activation links, payment receipts and expiry reminders go to your members from your own WhatsApp number, through a gateway account (Fonnte or Wablas).
            </p>
            <WhatsappForm
              slug={params.slug}
              configured={Boolean(wa)}
              initial={{
                provider: (wa?.gatewayProvider as "fonnte" | "wablas") ?? "fonnte",
                senderNumber: wa?.senderNumber ?? "",
                isActive: wa?.isActive ?? true,
              }}
              ownerPhone={owner?.phone ?? ""}
            />
            {recent.length > 0 && (
              <div className="mt-6 border-t border-neutral-800 pt-4">
                <p className="mb-2 text-sm text-neutral-400">Latest messages</p>
                <ul className="space-y-1 text-sm">
                  {recent.map((n) => (
                    <li key={n.id} className="flex flex-wrap justify-between gap-x-4">
                      <span className="text-neutral-300">{n.type.replace(/_/g, " ")}</span>
                      <span className="flex gap-3">
                        <span className={STATUS_TONE[n.status] ?? "text-neutral-400"}>
                          {n.status === "SKIPPED" ? "Not sent (WhatsApp not set up)" : n.status.toLowerCase()}
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
          <Card title="Online sign-up">
            <JoinSettingsForm
              slug={params.slug}
              initial={gymAcceptsSignups(gym.settings)}
              joinUrl={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/g/${params.slug}/join`}
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
