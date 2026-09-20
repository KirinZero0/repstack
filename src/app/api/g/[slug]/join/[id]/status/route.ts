import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/** Public, minimal status for the post-payment page. The id is an unguessable UUID scoped to this gym. */
export async function GET(_req: Request, { params }: { params: { slug: string; id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const signup = await prisma.memberSignup.findUnique({
    where: { id: params.id },
    select: { status: true, gym: { select: { slug: true, name: true } } },
  });
  if (!signup || signup.gym.slug !== params.slug) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ status: signup.status, gymName: signup.gym.name });
}
