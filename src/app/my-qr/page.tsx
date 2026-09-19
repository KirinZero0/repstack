import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { buildQrToken } from "@/lib/qr";
import { findValidMagicLink } from "@/lib/magicLink";

export const dynamic = "force-dynamic";

export default async function MyQrPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const session = await getSession();

  let member: { id: string; fullName: string; qrSecret: string; gymId: string; status: string } | null =
    null;

  if (session?.kind === "member") {
    member = await prisma.member.findUnique({ where: { id: session.memberId } });
  } else if (searchParams.token) {
    const link = await findValidMagicLink(searchParams.token, "qr_fallback");
    if (link) {
      member = link.member;
    }
  }

  if (!member) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <div className="text-center">
          <p className="mb-4 text-neutral-300">
            No active session or the QR link is invalid, expired, or already used.
          </p>
          <p className="text-sm text-neutral-500">
            Ask a staff member for a fresh QR link, or log in with your gym&apos;s member login.
          </p>
        </div>
      </main>
    );
  }

  const token = buildQrToken(
    { gymId: member.gymId, memberId: member.id, issuedAt: Date.now() },
    member.qrSecret,
  );
  const qrDataUrl = await QRCode.toDataURL(token, { width: 320, margin: 2 });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-950 px-4 text-white">
      <h1 className="text-xl font-semibold">{member.fullName}</h1>
      <div className="rounded-xl bg-white p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl} alt="Your check-in QR code" width={320} height={320} />
      </div>
      <p className="text-sm text-neutral-400">Show this to gym staff at check-in.</p>
      {session?.kind === "member" && (
        <a href="/my" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Dashboard
        </a>
      )}
      {session?.kind === "member" && (
        <a
          href="/check-in"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200"
        >
          Check in now →
        </a>
      )}
    </main>
  );
}
