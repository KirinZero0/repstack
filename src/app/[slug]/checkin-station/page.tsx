import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { requireTenantSession, SessionError } from "@/lib/session";
import { buildStationToken } from "@/lib/qr";
import PrintButton from "./PrintButton";

export default async function CheckinStationPage({ params }: { params: { slug: string } }) {
  let gym;
  try {
    ({ gym } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  const token = buildStationToken(gym.id);
  const qrDataUrl = await QRCode.toDataURL(token, { width: 480, margin: 2 });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-950 px-4 text-white print:bg-[#ffffff] print:text-black">
      <h1 className="text-2xl font-semibold">{gym.name} — Check-in</h1>
      <div className="rounded-xl bg-[#ffffff] p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl} alt="Gym check-in station QR code" width={480} height={480} />
      </div>
      <p className="max-w-sm text-center text-neutral-400 print:text-black">
        Members: open your Liftmora app and scan this code to check yourself in.
      </p>
      <div className="flex gap-3 print:hidden">
        <PrintButton />
        <a href={`/${params.slug}/dashboard`} className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Back to dashboard
        </a>
      </div>
      <p className="text-xs text-neutral-600 print:hidden">
        This code doesn&apos;t change — print it once and mount it at the entrance. Staff can still
        scan a member&apos;s own QR from{" "}
        <a href={`/${params.slug}/checkin`} className="underline">
          the staff scanner
        </a>{" "}
        as a fallback.
      </p>
    </main>
  );
}
