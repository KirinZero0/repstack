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
  message: "If that email has an account, we've sent a WhatsApp message with a link to set a new password.",
};

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * The gym-less counterpart of /api/[slug]/forgot, for the global login at /login — email alone finds
 * the account, whichever gym it belongs to. Same generic answer either way, same throttling.
 */
export async function POST(req: NextRequest) {
  const parsed = forgotPasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const { email } = parsed.data;

  const ipHash = hashClientIp(clientIp(req));
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const fromIp = await prisma.passwordReset.count({ where: { ipHash, createdAt: { gte: hourAgo } } });
  if (fromIp >= MAX_RESETS_PER_IP_HOUR) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const [staff, member] = await Promise.all([
    prisma.staffUser.findUnique({ where: { email }, include: { gym: true } }),
    prisma.member.findUnique({ where: { email }, include: { gym: true } }),
  ]);

  const tooMany = async (subjectId: string) =>
    (await prisma.passwordReset.count({ where: { subjectId, createdAt: { gte: hourAgo } } })) >= MAX_RESETS_PER_SUBJECT_HOUR;

  if (staff && staff.isActive && !(await tooMany(staff.id))) {
    const token = await createPasswordReset({ kind: "staff", subjectId: staff.id, purpose: "reset", ipHash });
    waitUntil(
      deliverResetLink({ kind: "staff", name: staff.name, token, purpose: "reset", staffPhone: staff.phone, gymName: staff.gym.name }),
    );
  }

  if (member && !(await tooMany(member.id))) {
    const token = await createPasswordReset({ kind: "member", subjectId: member.id, purpose: "reset", ipHash });
    waitUntil(
      deliverResetLink({
        kind: "member",
        name: member.fullName,
        token,
        purpose: "reset",
        member: { id: member.id, gymId: member.gymId, encryptedPhone: member.phoneWhatsapp },
        gymName: member.gym.name,
      }),
    );
  }

  return NextResponse.json(GENERIC);
}
