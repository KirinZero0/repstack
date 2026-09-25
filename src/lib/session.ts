import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export type SessionPayload =
  | { kind: "staff"; staffUserId: string; gymId: string; role: "OWNER" | "STAFF" }
  | { kind: "superadmin"; superadminId: string }
  | { kind: "member"; memberId: string; gymId: string };

const COOKIE_NAME = "iron_ledger_session";
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET env var not set");
  return secret;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: SEVEN_DAYS_SECONDS });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as SessionPayload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload) {
  const token = signSession(payload);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SEVEN_DAYS_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export class SessionError extends Error {
  constructor(
    public code: "UNAUTHENTICATED" | "FORBIDDEN" | "GYM_SUSPENDED" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Single choke point for every gym-scoped page/route.
 * Re-verifies the session's gymId against the slug in the URL — never trust a client-supplied gymId.
 * Also rejects if the gym's subscription is SUSPENDED or CANCELLED.
 */
export async function requireTenantSession(slug: string) {
  const session = await getSession();
  if (!session || session.kind !== "staff") {
    throw new SessionError("UNAUTHENTICATED", "Staff session required");
  }

  const gym = await prisma.gym.findUnique({ where: { slug } });
  if (!gym) throw new SessionError("NOT_FOUND", "Gym not found");

  if (session.gymId !== gym.id) {
    throw new SessionError("FORBIDDEN", "Session does not belong to this gym");
  }

  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
    throw new SessionError("GYM_SUSPENDED", "This gym's subscription is not active");
  }

  // The JWT can't be revoked, so confirm against the database that this staff account still
  // exists and is active, and use its current role (a demotion or deactivation applies at once).
  const staff = await prisma.staffUser.findUnique({
    where: { id: session.staffUserId },
    select: { gymId: true, isActive: true, role: true },
  });
  if (!staff || !staff.isActive || staff.gymId !== gym.id) {
    throw new SessionError("UNAUTHENTICATED", "This staff account is no longer active");
  }

  return { session: { ...session, role: staff.role }, gym };
}

/** Same choke point for member-facing routes (e.g. /my-qr, member dashboard if added later). */
export async function requireMemberSession(slug: string) {
  const session = await getSession();
  if (!session || session.kind !== "member") {
    throw new SessionError("UNAUTHENTICATED", "Member session required");
  }

  const gym = await prisma.gym.findUnique({ where: { slug } });
  if (!gym) throw new SessionError("NOT_FOUND", "Gym not found");

  if (session.gymId !== gym.id) {
    throw new SessionError("FORBIDDEN", "Session does not belong to this gym");
  }

  return { session, gym };
}

export async function requireSuperadminSession() {
  const session = await getSession();
  if (!session || session.kind !== "superadmin") {
    throw new SessionError("UNAUTHENTICATED", "Superadmin session required");
  }
  return { session };
}
