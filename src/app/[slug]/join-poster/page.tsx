import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { requireTenantSession, SessionError } from "@/lib/session";
import PrintButton from "../checkin-station/PrintButton";

export const dynamic = "force-dynamic";

export default async function JoinPosterPage({ params }: { params: { slug: string } }) {
  let gym;
  try {
    ({ gym } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/${gym.slug}/join`;
  const qr = await QRCode.toDataURL(url, { width: 480, margin: 2 });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-950 px-4 text-white print:bg-[#ffffff] print:text-black">
      <h1 className="text-center text-3xl font-semibold">Join {gym.name}</h1>
      <div className="rounded-xl bg-[#ffffff] p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={`QR code to join ${gym.name}`} width={480} height={480} />
      </div>
      <p className="max-w-sm text-center text-neutral-400 print:text-black">
        Scan with your phone camera to pick a plan, pay and start training today.
      </p>
      <div className="flex gap-4 print:hidden">
        <PrintButton />
        <a href={`/${params.slug}/settings`} className="self-center text-sm text-neutral-500 hover:text-neutral-300">← Settings</a>
      </div>
    </main>
  );
}
