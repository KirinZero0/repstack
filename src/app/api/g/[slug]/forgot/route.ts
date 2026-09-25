import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { forgotPasswordSchema } from "@/lib/validation/tenant";
import {
  MAX_RESETS_PER_IP_HOUR,
  MAX_RESETS_PER_SUBJECT_HOUR,
  createPasswordReset,
  deliverResetLink,
  hashClientIp,
} from "@/lib/passwordReset";

const GENERIC = {
  ok: true,
  message: "If that email has an account here, we've sent a WhatsApp message with a link to set a new password.",
};

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Public. Always answers the same way whether or not the email exists, so it can't be used to find
 * out who has an account. The link goes to the WhatsApp number on file, never back to the caller.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const parsed = forgotPasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const { email } = parsed.data;

  const gym = await prisma.gym.findUnique({ where: { slug: params.slug } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });

  // Throttling is per requester, not per account, so it says nothing about which accounts exist.
  const ipHash = hashClientIp(clientIp(req));
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const fromIp = await prisma.passwordReset.count({ where: { ipHash, createdAt: { gte: hourAgo } } });
  if (fromIp >= MAX_RESETS_PER_IP_HOUR) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const [staff, member] = await Promise.all([
    prisma.staffUser.findUnique({ where: { email } }),
    prisma.member.findUnique({ where: { email } }),
  ]);

  const tooMany = async (subjectId: string) =>
    (await prisma.passwordReset.count({ where: { subjectId, createdAt: { gte: hourAgo } } })) >= MAX_RESETS_PER_SUBJECT_HOUR;

  if (staff && staff.gymId === gym.id && staff.isActive && !(await tooMany(staff.id))) {
    const token = await createPasswordReset({ kind: "staff", subjectId: staff.id, purpose: "reset", ipHash });
    waitUntil(
      deliverResetLink({ kind: "staff", name: staff.name, token, purpose: "reset", staffPhone: staff.phone, gymName: gym.name }),
    );
  }

  if (member && member.gymId === gym.id && !(await tooMany(member.id))) {
    const token = await createPasswordReset({ kind: "member", subjectId: member.id, purpose: "reset", ipHash });
    waitUntil(
      deliverResetLink({
        kind: "member",
        name: member.fullName,
        token,
        purpose: "reset",
        member: { id: member.id, gymId: member.gymId, encryptedPhone: member.phoneWhatsapp },
        gymName: gym.name,
      }),
    );
  }

  return NextResponse.json(GENERIC);
}
