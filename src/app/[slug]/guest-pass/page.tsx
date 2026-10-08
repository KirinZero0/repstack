import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { whenLabel } from "@/lib/classes";
import GuestPassForm from "./GuestPassForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug }, select: { name: true } }).catch(() => null);
  return { title: gym ? `Try a class at ${gym.name}` : "Try a class" };
}

/** Public: a non-member picks an upcoming class session and asks for a spot. Staff approve before any ticket exists. */
export default async function GuestPassPage({ params }: { params: { slug: string } }) {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) notFound();

  const open = gym.subscriptionStatus !== "SUSPENDED" && gym.subscriptionStatus !== "CANCELLED";
  const sessions = open
    ? await prisma.classSession.findMany({
        where: { gymId: gym.id, status: "SCHEDULED", startsAt: { gt: new Date() }, class: { isActive: true } },
        orderBy: { startsAt: "asc" },
        take: 40,
        include: { class: true },
      })
    : [];

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-neutral-400">{gym.name}</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Try a class</h1>
        {sessions.length === 0 ? (
          <p className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-300">
            There are no classes open for guests right now. Please ask at the front desk.
          </p>
        ) : (
          <>
            <p className="mt-3 max-w-md text-neutral-400">
              Not a member? Pick a class and ask for a spot. Once the gym approves, you get a one-time QR ticket on WhatsApp.
            </p>
            <div className="mt-10">
              <GuestPassForm
                slug={params.slug}
                sessions={sessions.map((s) => ({ id: s.id, label: whenLabel(s.startsAt, gym.timezone), className: s.class.name, instructor: s.class.instructor }))}
              />
            </div>
          </>
        )}
        <a href={`/${params.slug}`} className="mt-8 inline-block text-sm text-neutral-500 hover:text-neutral-300">← {gym.name}</a>
      </div>
    </main>
  );
}
