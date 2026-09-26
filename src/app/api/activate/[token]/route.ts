import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { findValidMagicLink } from "@/lib/magicLink";
import { activateSchema } from "@/lib/validation/tenant";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const link = await findValidMagicLink(params.token, "activate");
  if (!link) {
    return NextResponse.json({ error: "Link is invalid, expired, or already used" }, { status: 404 });
  }
  const gym = await prisma.gym.findUnique({ where: { id: link.member.gymId } });
  return NextResponse.json({
    fullName: link.member.fullName,
    email: link.member.email,
    alreadyActivated: Boolean(link.member.passwordHash),
    gymSlug: gym?.slug ?? null,
  });
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const link = await findValidMagicLink(params.token, "activate");
  if (!link) {
    return NextResponse.json({ error: "Link is invalid, expired, or already used" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const parsed = activateSchema.safeParse({ password: form.get("password"), acceptTerms: form.get("acceptTerms") === "true" });
  if (!parsed.success) {
    const termsMissing = parsed.error.issues.some((i) => i.path[0] === "acceptTerms");
    return NextResponse.json(
      { error: termsMissing ? "Please accept the terms and privacy policy to continue." : "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const photo = form.get("photo");
  let photoUrl: string | undefined;

  if (photo instanceof File && photo.size > 0) {
    if (!ALLOWED_MIME.has(photo.type)) {
      return NextResponse.json({ error: "Photo must be JPEG, PNG, or WebP" }, { status: 400 });
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "Photo must be under 2MB" }, { status: 400 });
    }
    // Photo is optional — never let a Blob failure (bad/missing creds, network) block the
    // member from setting their password, which is the part of activation that matters.
    try {
      const blob = await put(`member-photos/${link.memberId}-${Date.now()}`, photo, {
        access: "private",
        contentType: photo.type,
      });
      photoUrl = blob.url;
    } catch (err) {
      console.error("Profile photo upload failed, continuing activation without it", err);
    }
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  await prisma.$transaction([
    prisma.member.update({
      where: { id: link.memberId },
      data: { passwordHash, termsAcceptedAt: new Date(), ...(photoUrl ? { photoUrl } : {}) },
    }),
    prisma.magicLink.update({
      where: { id: link.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
