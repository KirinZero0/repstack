import crypto from "crypto";

export interface QrTokenPayload {
  gymId: string;
  memberId: string;
  issuedAt: number;
}

function getServerSecret(): string {
  const secret = process.env.QR_SERVER_SECRET;
  if (!secret) throw new Error("QR_SERVER_SECRET env var not set");
  return secret;
}

function sign(payload: QrTokenPayload, memberQrSecret: string): string {
  const data = `${payload.gymId}.${payload.memberId}.${payload.issuedAt}`;
  return crypto
    .createHmac("sha256", `${memberQrSecret}.${getServerSecret()}`)
    .update(data)
    .digest("hex");
}

/** Builds the opaque token embedded in the member's QR code image. */
export function buildQrToken(payload: QrTokenPayload, memberQrSecret: string): string {
  const signature = sign(payload, memberQrSecret);
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature}`;
}

/** Parses a scanned token into its payload without verifying — caller must verify separately. */
export function parseQrToken(token: string): QrTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as QrTokenPayload;
    if (
      typeof payload.gymId !== "string" ||
      typeof payload.memberId !== "string" ||
      typeof payload.issuedAt !== "number"
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verifies a scanned token's signature against the member's CURRENT qrSecret.
 * Rotating qrSecret instantly invalidates all previously issued codes for that member.
 */
export function verifyQrToken(token: string, memberQrSecret: string): QrTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const payload = parseQrToken(token);
  if (!payload) return null;
  const expected = sign(payload, memberQrSecret);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;
  return payload;
}
