import crypto from "crypto";
import { prisma } from "./prisma";

/** Generates a random token; returns both the raw token (goes in the URL) and its hash (stored in DB). */
export function generateMagicToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

export function hashMagicToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createMagicLink(params: {
  memberId: string;
  purpose: "activate" | "qr_fallback";
  expiresInMs: number;
}) {
  const { token, tokenHash } = generateMagicToken();
  const link = await prisma.magicLink.create({
    data: {
      memberId: params.memberId,
      purpose: params.purpose,
      tokenHash,
      expiresAt: new Date(Date.now() + params.expiresInMs),
    },
  });
  return { token, link };
}

/** Looks up a still-valid (unused, unexpired) magic link by its raw token. */
export async function findValidMagicLink(token: string, purpose?: string) {
  const tokenHash = hashMagicToken(token);
  const link = await prisma.magicLink.findUnique({ where: { tokenHash }, include: { member: true } });
  if (!link) return null;
  if (purpose && link.purpose !== purpose) return null;
  if (link.usedAt) return null;
  if (link.expiresAt < new Date()) return null;
  return link;
}

/**
 * Kills every link that lets someone set this member's password: unused activation links and unused
 * password-reset links. Called when staff change the member's email, so a link already sent to the old
 * address or sitting in an old message can't be used to take over the account. (The QR-only fallback
 * link is not a password link and is left alone.) Returns how many links were revoked.
 */
export async function revokeMemberPasswordLinks(memberId: string): Promise<number> {
  const now = new Date();
  const [activation, resets] = await prisma.$transaction([
    prisma.magicLink.updateMany({ where: { memberId, purpose: "activate", usedAt: null }, data: { usedAt: now } }),
    prisma.passwordReset.updateMany({ where: { kind: "member", subjectId: memberId, usedAt: null }, data: { usedAt: now } }),
  ]);
  return activation.count + resets.count;
}
