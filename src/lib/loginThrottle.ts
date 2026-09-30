import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "./prisma";

/**
 * Shared across every login route (global, per-gym, staff, member, superadmin) — cycling between
 * them to dodge a per-route limit still hits the same budget. High enough that one shared IP (a
 * gym's front-desk kiosk, reused all day by staff and members) never trips it during normal use,
 * but still a real cut against scripted brute force on top of bcrypt's own per-guess cost.
 */
export const MAX_LOGIN_ATTEMPTS_PER_IP_HOUR = 200;

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

function hashIp(ip: string): string {
  const key = process.env.LOOKUP_HMAC_KEY;
  if (!key) throw new Error("LOOKUP_HMAC_KEY env var not set");
  return crypto.createHmac("sha256", key).update(`ip:${ip}`).digest("hex");
}

/**
 * Records this attempt and reports whether the IP is over budget for the past hour. Records first
 * so a burst that arrives concurrently still gets counted, not just the requests that lose the race.
 */
export async function checkLoginThrottle(req: NextRequest): Promise<boolean> {
  const ipHash = hashIp(clientIp(req));
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  // Sequenced, not Promise.all: the count must see this request's own just-inserted row, which
  // isn't guaranteed if both queries run concurrently on separate pooled connections.
  await prisma.loginAttempt.create({ data: { ipHash } });
  const count = await prisma.loginAttempt.count({ where: { ipHash, createdAt: { gte: hourAgo } } });
  return count <= MAX_LOGIN_ATTEMPTS_PER_IP_HOUR;
}
