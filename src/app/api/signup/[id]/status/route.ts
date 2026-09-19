import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/** Public, minimal status for the post-payment page. The id is an unguessable UUID. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const signup = await prisma.gymSignup.findUnique({
    where: { id: params.id },
    select: { status: true, slug: true, gymName: true },
  });
  if (!signup) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(signup);
}
