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

// ─── Station QR (member scans a fixed gym poster, no per-member identity in the token) ───

/** Static, non-rotating token identifying a gym's check-in station — meant to be printed. */
export function buildStationToken(gymId: string): string {
  const signature = crypto.createHmac("sha256", getServerSecret()).update(gymId).digest("hex");
  const body = Buffer.from(gymId).toString("base64url");
  return `station.${body}.${signature}`;
}

/** Verifies a scanned station token and returns the gymId it was issued for. */
export function verifyStationToken(token: string): string | null {
  const [prefix, body, signature] = token.split(".");
  if (prefix !== "station" || !body || !signature) return null;
  let gymId: string;
  try {
    gymId = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", getServerSecret()).update(gymId).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;
  return gymId;
}

// ─── Guest class ticket (one-time QR for a non-member, tied to one GuestPass) ───

export interface TicketTokenPayload {
  gymId: string;
  passId: string;
}

function signTicket(payload: TicketTokenPayload, ticketSecret: string): string {
  return crypto
    .createHmac("sha256", `${ticketSecret}.${getServerSecret()}`)
    .update(`ticket:${payload.gymId}.${payload.passId}`)
    .digest("hex");
}

/** Builds the opaque token in a guest's ticket QR (and ticket link). Rotating ticketSecret voids it. */
export function buildTicketToken(payload: TicketTokenPayload, ticketSecret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `ticket.${body}.${signTicket(payload, ticketSecret)}`;
}

export function isTicketToken(token: string): boolean {
  return token.startsWith("ticket.");
}

/** Parses a scanned ticket without verifying it — caller must verifyTicketToken against the pass's secret. */
export function parseTicketToken(token: string): TicketTokenPayload | null {
  const [prefix, body, signature] = token.split(".");
  if (prefix !== "ticket" || !body || !signature) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TicketTokenPayload;
    if (typeof payload.gymId !== "string" || typeof payload.passId !== "string") return null;
    return { gymId: payload.gymId, passId: payload.passId };
  } catch {
    return null;
  }
}

export function verifyTicketToken(token: string, ticketSecret: string): TicketTokenPayload | null {
  const payload = parseTicketToken(token);
  if (!payload) return null;
  const signature = token.split(".")[2];
  const expectedBuf = Buffer.from(signTicket(payload, ticketSecret), "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;
  return payload;
}
