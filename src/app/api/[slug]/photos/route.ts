import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { putPublicImage } from "@/lib/blob";
import { MAX_GYM_PHOTOS } from "@/lib/validation/tenant";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Owner uploads one photo for the gym's public profile page. Public blob, appended to Gym.photoUrls. */
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

  const form = await req.formData().catch(() => null);
  const photo = form?.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: "Choose a photo to upload" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(photo.type)) {
    return NextResponse.json({ error: "Photo must be JPEG, PNG, or WebP" }, { status: 400 });
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Photo must be under 5MB" }, { status: 400 });
  }

  // Re-read the current list rather than trusting the row from the session lookup, and check the
  // cap server-side: the client's count is only a convenience.
  const current = await db.gym.findUniqueOrThrow({ where: { id: gym.id }, select: { photoUrls: true } });
  if (current.photoUrls.length >= MAX_GYM_PHOTOS) {
    return NextResponse.json({ error: `You can show up to ${MAX_GYM_PHOTOS} photos. Remove one first.` }, { status: 409 });
  }

  let url: string;
  try {
    url = await putPublicImage(`gym-photos/${gym.id}/${Date.now()}`, photo, photo.type);
  } catch (err) {
    console.error("Gym photo upload failed", err);
    return NextResponse.json({ error: "The photo couldn't be uploaded. Try again in a moment." }, { status: 502 });
  }

  await db.gym.update({ where: { id: gym.id }, data: { photoUrls: { push: url } } });
  return NextResponse.json({ url }, { status: 201 });
}
