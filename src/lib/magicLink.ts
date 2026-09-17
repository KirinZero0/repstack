import crypto from "crypto";
import { prisma } from "@/lib/prisma";

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
