import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { decrypt } from "./crypto";
import { generateMagicToken, hashMagicToken } from "./magicLink";
import { sendGymWhatsapp, sendPlatformWhatsapp } from "./whatsapp";

export const RESET_TTL_MS = 60 * 60 * 1000; // self-service "forgot password" links
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // staff invites created by an owner
export const MAX_RESETS_PER_SUBJECT_HOUR = 3;
export const MAX_RESETS_PER_IP_HOUR = 10;

export type ResetKind = "staff" | "member";

export function hashClientIp(ip: string): string {
  const key = process.env.LOOKUP_HMAC_KEY;
  if (!key) throw new Error("LOOKUP_HMAC_KEY env var not set");
  return crypto.createHmac("sha256", key).update(`ip:${ip}`).digest("hex");
}

export function resetUrl(token: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/reset/${token}`;
}

/** Creates a one-time link and returns the raw token (only its hash is stored). */
export async function createPasswordReset(params: {
  kind: ResetKind;
  subjectId: string;
  purpose: "reset" | "invite";
  ipHash?: string;
}): Promise<string> {
  const { token, tokenHash } = generateMagicToken();
  await prisma.passwordReset.create({
    data: {
      kind: params.kind,
      subjectId: params.subjectId,
      purpose: params.purpose,
      tokenHash,
      ipHash: params.ipHash,
      expiresAt: new Date(Date.now() + (params.purpose === "invite" ? INVITE_TTL_MS : RESET_TTL_MS)),
    },
  });
  return token;
}

export async function findValidReset(token: string) {
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashMagicToken(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  return row;
}

/** Describes what a link is for, without exposing anything sensitive. */
export async function describeReset(token: string) {
  const row = await findValidReset(token);
  if (!row) return null;
  if (row.kind === "staff") {
    const staff = await prisma.staffUser.findUnique({ where: { id: row.subjectId }, include: { gym: true } });
    if (!staff || !staff.isActive) return null;
    return { purpose: row.purpose, name: staff.name, gymName: staff.gym.name, gymSlug: staff.gym.slug };
  }
  const member = await prisma.member.findUnique({ where: { id: row.subjectId }, include: { gym: true } });
  if (!member) return null;
  return { purpose: row.purpose, name: member.fullName, gymName: member.gym.name, gymSlug: member.gym.slug };
}

/**
 * Sets the new password and burns the link, plus any other outstanding links for the same
 * person. The claim is a conditional update so two simultaneous submits can't both succeed.
 */
export async function applyPasswordReset(token: string, newPassword: string): Promise<{ gymSlug: string } | null> {
  const row = await findValidReset(token);
  if (!row) return null;
  const info = await describeReset(token);
  if (!info) return null;

  const claimed = await prisma.passwordReset.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;

  const passwordHash = await bcrypt.hash(newPassword, 10);
  if (row.kind === "staff") {
    await prisma.staffUser.update({ where: { id: row.subjectId }, data: { passwordHash } });
  } else {
    await prisma.member.update({ where: { id: row.subjectId }, data: { passwordHash } });
  }
  await prisma.passwordReset.updateMany({
    where: { subjectId: row.subjectId, usedAt: null },
    data: { usedAt: new Date() },
  });
  return { gymSlug: info.gymSlug };
}

/** A random password nobody knows, so a freshly invited account can't be logged into until the link is used. */
export async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
}

/** Sends the link over WhatsApp where there's a channel for it. Never throws. */
export async function deliverResetLink(target: {
  kind: ResetKind;
  name: string;
  token: string;
  purpose: "reset" | "invite";
  /** staff: the phone on their profile (plain). member: use memberWhatsapp instead. */
  staffPhone?: string | null;
  member?: { id: string; gymId: string; encryptedPhone: string };
  gymName: string;
}): Promise<void> {
  const url = resetUrl(target.token);
  const message =
    target.purpose === "invite"
      ? `Hi ${target.name}, you've been added to ${target.gymName} on Repstack. Set your password here: ${url} (valid 7 days)`
      : `Hi ${target.name}, use this link to set a new password for ${target.gymName}: ${url} (valid 1 hour). If you didn't ask for this, ignore it.`;
  try {
    if (target.kind === "staff") {
      if (target.staffPhone) await sendPlatformWhatsapp({ to: target.staffPhone, message });
    } else if (target.member) {
      await sendGymWhatsapp(target.member.gymId, {
        to: decrypt(target.member.encryptedPhone),
        message,
        type: "password_reset",
        memberId: target.member.id,
      });
    }
  } catch (err) {
    console.error("Password reset delivery failed", err);
  }
}
