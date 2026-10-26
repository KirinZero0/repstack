import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Where the installed app opens. Sends whoever is signed in to their own home, and anyone else to
 * the login, so a single "Add to Home Screen" works for owners, staff, members and the superadmin.
 */
export default async function OpenPage() {
  const session = await getSession();
  if (session?.kind === "superadmin") redirect("/superadmin/dashboard");
  if (session?.kind === "member") redirect("/my");
  if (session?.kind === "staff") {
    const gym = await prisma.gym.findUnique({ where: { id: session.gymId }, select: { slug: true } });
    if (gym) redirect(`/${gym.slug}/dashboard`);
  }
  redirect("/login");
}
