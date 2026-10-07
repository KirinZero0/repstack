import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { gymAcceptsSignups } from "@/lib/memberSignup";
import BrandMark from "@/components/BrandMark";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const gym = await prisma.gym.findUnique({ where: { slug: params.slug }, select: { name: true, description: true } }).catch(() => null);
  return gym
    ? { title: `${gym.name} · Liftmora`, description: gym.description?.slice(0, 160) ?? `${gym.name} on Liftmora` }
    : { title: "Gym not found" };
}

/**
 * A gym's public profile: liftmora.com/<slug>. No session, so this uses the owner client and only
 * shows what a poster would — name, description, address, photos, class types. Never member data
 * or money. A suspended gym still has a page, just no way to join.
 */
export default async function GymProfilePage({ params }: { params: { slug: string } }) {
  const gym = await prisma.gym.findUnique({
    where: { slug: params.slug },
    select: {
      id: true,
      name: true,
      description: true,
      address: true,
      photoUrls: true,
      settings: true,
      subscriptionStatus: true,
    },
  });
  if (!gym) notFound();

  const classes = await prisma.gymClass.findMany({
    where: { gymId: gym.id, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, instructor: true, durationMinutes: true, description: true },
  });

  const live = gym.subscriptionStatus !== "SUSPENDED" && gym.subscriptionStatus !== "CANCELLED";
  const canJoin = live && gymAcceptsSignups(gym.settings);
  const [hero, ...rest] = gym.photoUrls;

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <BrandMark />
          <nav className="flex items-center gap-4 text-sm">
            <a href={`/${params.slug}/login`} className="rounded-full border border-neutral-700 px-4 py-1.5 text-neutral-200 hover:bg-neutral-900">
              Log in
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24 pt-12">
        <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div>
            <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">{gym.name}</h1>
            {gym.address && <p className="mt-3 text-neutral-400">{gym.address}</p>}
            {gym.description ? (
              <p className="mt-6 max-w-xl whitespace-pre-line leading-relaxed text-neutral-300">{gym.description}</p>
            ) : (
              <p className="mt-6 max-w-xl text-neutral-500">This gym hasn&apos;t written a description yet.</p>
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              {canJoin && (
                <a href={`/${params.slug}/join`} className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-neutral-200">
                  Join {gym.name}
                </a>
              )}
              <a href={`/${params.slug}/login`} className="rounded-lg border border-neutral-700 px-6 py-3 text-sm font-semibold text-white hover:bg-neutral-900">
                Member or staff? Log in
              </a>
            </div>
            {!canJoin && live && (
              <p className="mt-4 text-sm text-neutral-500">To become a member, ask at the front desk.</p>
            )}
          </div>

          {hero ? (
            <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={hero} alt={`${gym.name}`} className="aspect-[4/3] w-full object-cover" />
            </div>
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border border-dashed border-neutral-800 text-sm text-neutral-600">
              No photos yet
            </div>
          )}
        </section>

        {rest.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-sm font-medium text-neutral-400">Photos</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {rest.map((url, i) => (
                <li key={url} className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`${gym.name} photo ${i + 2}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                </li>
              ))}
            </ul>
          </section>
        )}

        {classes.length > 0 && (
          <section className="mt-14">
            <h2 className="text-2xl font-semibold">Classes</h2>
            <p className="mt-1 text-sm text-neutral-400">Members book and pay for classes from their dashboard.</p>
            <ul className="mt-6 divide-y divide-neutral-800 border-y border-neutral-800">
              {classes.map((c) => (
                <li key={c.id} className="grid gap-1 py-4 sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-6">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    {c.description && <p className="mt-1 max-w-xl text-sm text-neutral-400">{c.description}</p>}
                  </div>
                  <p className="text-sm text-neutral-400">
                    {c.durationMinutes} min{c.instructor ? ` · ${c.instructor}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="border-t border-neutral-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-neutral-500">
          <span>Powered by <a href="/" className="text-neutral-300 hover:text-white">Liftmora</a></span>
          <nav className="flex gap-6">
            <a href="/terms" className="hover:text-neutral-300">Terms</a>
            <a href="/privacy" className="hover:text-neutral-300">Privacy</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
