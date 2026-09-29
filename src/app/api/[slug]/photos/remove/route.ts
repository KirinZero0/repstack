import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { deleteBlob } from "@/lib/blob";
import { removeGymPhotoSchema } from "@/lib/validation/tenant";

/** Owner removes one photo from the gym's public profile and deletes the blob behind it. */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
  if (session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can change gym photos" }, { status: 403 });
  }

  const parsed = removeGymPhotoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Only a URL this gym actually holds can be removed — never delete an arbitrary blob.
  const current = await db.gym.findUniqueOrThrow({ where: { id: gym.id }, select: { photoUrls: true } });
  if (!current.photoUrls.includes(parsed.data.url)) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  await db.gym.update({
    where: { id: gym.id },
    data: { photoUrls: current.photoUrls.filter((u) => u !== parsed.data.url) },
  });
  await deleteBlob(parsed.data.url);
  return NextResponse.json({ ok: true });
}
