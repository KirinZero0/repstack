import crypto from "crypto";

/*
 * Every QR in the app carries a signed token. There are three kinds: a member's own code (scanned by
 * staff), a guest's one-time class/day-pass ticket, and the gym's station poster (scanned by members).
 *
 * Each now has a COMPACT format (prefix m1 / t1 / s1): the ids as 16 raw bytes instead of 36-character
 * text, wrapped in base64url, with a 96-bit truncated HMAC tag. That makes the code about a third of the
 * size, so its squares are about twice as big on screen and a camera can read it from further away, in
 * worse light and on older phones. 96 bits is far beyond guessable, and every attempt is a network call.
 *
 * The original long formats still verify, so codes already issued (saved screenshots, tickets already
 * sent over WhatsApp, printed station posters) keep working. New codes are always compact, with one
 * fallback: an id that isn't a standard UUID is encoded in the long format, so nothing can fail to build.
 */

function getServerSecret(): string {
  const secret = process.env.QR_SERVER_SECRET;
  if (!secret) throw new Error("QR_SERVER_SECRET env var not set");
  return secret;
}

const TAG_BYTES = 12;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidToBytes = (u: string) => Buffer.from(u.replace(/-/g, ""), "hex");
const bytesToUuid = (b: Buffer) => {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

type Kind = "m1" | "t1" | "s1";

function compactTag(kind: Kind, body: Buffer, key: string): Buffer {
  return crypto.createHmac("sha256", key).update(kind).update(body).digest().subarray(0, TAG_BYTES);
}

/** Splits "<prefix>.<base64url>" into its body and tag, or null if it isn't that shape or length. */
function splitCompact(token: string, kind: Kind, bodyBytes: number): { body: Buffer; tag: Buffer } | null {
  if (!token.startsWith(`${kind}.`)) return null;
  const raw = Buffer.from(token.slice(kind.length + 1), "base64url");
  if (raw.length !== bodyBytes + TAG_BYTES) return null;
  return { body: raw.subarray(0, bodyBytes), tag: raw.subarray(bodyBytes) };
}

const tagMatches = (a: Buffer, b: Buffer) => a.length === b.length && crypto.timingSafeEqual(a, b);

// ─── Member QR (staff scans a member's own code) ───

export interface QrTokenPayload {
  gymId: string;
  memberId: string;
  issuedAt: number;
}

const memberKey = (memberQrSecret: string) => `${memberQrSecret}.${getServerSecret()}`;
const MEMBER_BODY = 16 + 16 + 4; // gymId, memberId, issuedAt (seconds)

function signLegacy(payload: QrTokenPayload, memberQrSecret: string): string {
  const data = `${payload.gymId}.${payload.memberId}.${payload.issuedAt}`;
  return crypto.createHmac("sha256", memberKey(memberQrSecret)).update(data).digest("hex");
}

/** The original long format. Kept so old codes verify (and for tests); new codes use buildQrToken. */
export function buildLegacyQrToken(payload: QrTokenPayload, memberQrSecret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signLegacy(payload, memberQrSecret)}`;
}

/** Builds the opaque token embedded in the member's QR code image. */
export function buildQrToken(payload: QrTokenPayload, memberQrSecret: string): string {
  if (!UUID_RE.test(payload.gymId) || !UUID_RE.test(payload.memberId)) return buildLegacyQrToken(payload, memberQrSecret);
  const seconds = Buffer.alloc(4);
  seconds.writeUInt32BE(Math.floor(payload.issuedAt / 1000));
  const body = Buffer.concat([uuidToBytes(payload.gymId), uuidToBytes(payload.memberId), seconds]);
  return `m1.${Buffer.concat([body, compactTag("m1", body, memberKey(memberQrSecret))]).toString("base64url")}`;
}

function memberPayloadFromBody(body: Buffer): QrTokenPayload {
  return { gymId: bytesToUuid(body.subarray(0, 16)), memberId: bytesToUuid(body.subarray(16, 32)), issuedAt: body.readUInt32BE(32) * 1000 };
}

/** Parses a scanned token into its payload without verifying — caller must verify separately. */
export function parseQrToken(token: string): QrTokenPayload | null {
  const compact = splitCompact(token, "m1", MEMBER_BODY);
  if (compact) return memberPayloadFromBody(compact.body);

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as QrTokenPayload;
    if (typeof payload.gymId !== "string" || typeof payload.memberId !== "string" || typeof payload.issuedAt !== "number") return null;
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
  const compact = splitCompact(token, "m1", MEMBER_BODY);
  if (compact) {
    return tagMatches(compact.tag, compactTag("m1", compact.body, memberKey(memberQrSecret))) ? memberPayloadFromBody(compact.body) : null;
  }

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const payload = parseQrToken(token);
  if (!payload) return null;
  const expectedBuf = Buffer.from(signLegacy(payload, memberQrSecret), "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;
  return payload;
}

// ─── Station QR (member scans a fixed gym poster, no per-member identity in the token) ───

const STATION_BODY = 16;

/** The original long format of the station token (printed posters may still carry it). */
export function buildLegacyStationToken(gymId: string): string {
  const signature = crypto.createHmac("sha256", getServerSecret()).update(gymId).digest("hex");
  const body = Buffer.from(gymId).toString("base64url");
  return `station.${body}.${signature}`;
}

/** Static, non-rotating token identifying a gym's check-in station — meant to be printed. */
export function buildStationToken(gymId: string): string {
  if (!UUID_RE.test(gymId)) return buildLegacyStationToken(gymId);
  const body = uuidToBytes(gymId);
  return `s1.${Buffer.concat([body, compactTag("s1", body, getServerSecret())]).toString("base64url")}`;
}

/** Verifies a scanned station token and returns the gymId it was issued for. */
export function verifyStationToken(token: string): string | null {
  const compact = splitCompact(token, "s1", STATION_BODY);
  if (compact) return tagMatches(compact.tag, compactTag("s1", compact.body, getServerSecret())) ? bytesToUuid(compact.body) : null;

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

const ticketKey = (ticketSecret: string) => `${ticketSecret}.${getServerSecret()}`;
const TICKET_BODY = 16 + 16;

function signTicketLegacy(payload: TicketTokenPayload, ticketSecret: string): string {
  return crypto.createHmac("sha256", ticketKey(ticketSecret)).update(`ticket:${payload.gymId}.${payload.passId}`).digest("hex");
}

/** The original long format of a ticket. Tickets already sent by WhatsApp use it until they expire. */
export function buildLegacyTicketToken(payload: TicketTokenPayload, ticketSecret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `ticket.${body}.${signTicketLegacy(payload, ticketSecret)}`;
}

/** Builds the opaque token in a guest's ticket QR (and ticket link). Rotating ticketSecret voids it. */
export function buildTicketToken(payload: TicketTokenPayload, ticketSecret: string): string {
  if (!UUID_RE.test(payload.gymId) || !UUID_RE.test(payload.passId)) return buildLegacyTicketToken(payload, ticketSecret);
  const body = Buffer.concat([uuidToBytes(payload.gymId), uuidToBytes(payload.passId)]);
  return `t1.${Buffer.concat([body, compactTag("t1", body, ticketKey(ticketSecret))]).toString("base64url")}`;
}

export function isTicketToken(token: string): boolean {
  return token.startsWith("ticket.") || token.startsWith("t1.");
}

/** Parses a scanned ticket without verifying it — caller must verifyTicketToken against the pass's secret. */
export function parseTicketToken(token: string): TicketTokenPayload | null {
  const compact = splitCompact(token, "t1", TICKET_BODY);
  if (compact) return { gymId: bytesToUuid(compact.body.subarray(0, 16)), passId: bytesToUuid(compact.body.subarray(16, 32)) };

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
  const compact = splitCompact(token, "t1", TICKET_BODY);
  if (compact) {
    return tagMatches(compact.tag, compactTag("t1", compact.body, ticketKey(ticketSecret))) ? parseTicketToken(token) : null;
  }

  const payload = parseTicketToken(token);
  if (!payload) return null;
  const signature = token.split(".")[2];
  const expectedBuf = Buffer.from(signTicketLegacy(payload, ticketSecret), "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;
  return payload;
}
