import { NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Where member pages send a session whose account is gone (deleted or erased). Clears the cookie,
 * so the installed app doesn't keep reopening a dead account, and lands on that gym's login.
 */
export async function GET() {
  const session = await getSession();
  let target = "/login";
  if (session?.kind === "member") {
    const gym = await prisma.gym.findUnique({ where: { id: session.gymId }, select: { slug: true } });
    if (gym) target = `/${gym.slug}/login`;
  }
  await clearSessionCookie();
  // Relative Location, so the redirect stays on whatever host the request came in on.
  return new NextResponse(null, { status: 307, headers: { Location: target } });
}
