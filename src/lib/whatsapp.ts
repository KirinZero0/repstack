import { prisma } from "./prisma";

export type GatewayProvider = "fonnte" | "wablas";

interface SendResult {
  ok: boolean;
  /** True when nothing was sent because no gateway is configured. */
  skipped?: boolean;
  providerResponse?: unknown;
  error?: string;
}

/** Both gateways answer HTTP 200 even for failures; the outcome is in the body's `status`. */
function judge(res: Response, body: unknown): SendResult {
  const status = (body as { status?: unknown } | undefined)?.status;
  const ok = res.ok && status !== false && status !== "false";
  const reason = (body as { reason?: unknown; message?: unknown } | undefined) ?? {};
  return {
    ok,
    providerResponse: body,
    error: ok ? undefined : String(reason.reason ?? reason.message ?? `Gateway returned HTTP ${res.status}`),
  };
}

async function sendViaFonnte(apiKey: string, to: string, message: string): Promise<SendResult> {
  try {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ target: to, message, countryCode: "62" }),
    });
    return judge(res, await res.json().catch(() => undefined));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendViaWablas(apiKey: string, to: string, message: string): Promise<SendResult> {
  try {
    const res = await fetch("https://console.wablas.com/api/send-message", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ phone: to, message }),
    });
    return judge(res, await res.json().catch(() => undefined));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sends through a specific gateway with an already-decrypted key. */
export function sendWithGateway(provider: GatewayProvider, apiKey: string, to: string, message: string): Promise<SendResult> {
  if (process.env.WHATSAPP_MOCK === "1" && process.env.NODE_ENV !== "production") {
    // Dev/test only: no network. A key starting with "bad" simulates a gateway rejection.
    console.log(`[whatsapp:mock] ${provider} -> ${to}: ${message}`);
    return Promise.resolve(
      apiKey.startsWith("bad") ? { ok: false, error: "Invalid token" } : { ok: true, providerResponse: { mock: true } },
    );
  }
  return provider === "wablas" ? sendViaWablas(apiKey, to, message) : sendViaFonnte(apiKey, to, message);
}

function skippedSend(to: string, message: string): SendResult {
  console.log(`[whatsapp:skipped] no gateway configured, would send to ${to}: ${message}`);
  return { ok: false, skipped: true, providerResponse: { skipped: true } };
}

/** The platform's own gateway account. Dev/test mock mode works without a real key. */
function platformGateway(): { provider: GatewayProvider; apiKey: string } | null {
  const mock = process.env.WHATSAPP_MOCK === "1" && process.env.NODE_ENV !== "production";
  const apiKey = process.env.PLATFORM_WHATSAPP_API_KEY || (mock ? "mock-platform-key" : "");
  if (!apiKey) return null;
  return { provider: (process.env.PLATFORM_WHATSAPP_PROVIDER ?? "fonnte") as GatewayProvider, apiKey };
}

/** Messages sent for a gym so far this calendar month (SENT only, so failures and blocked sends don't use up the quota). */
export async function gymWhatsappUsage(gymId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return prisma.notificationLog.count({ where: { gymId, channel: "whatsapp", status: "SENT", sentAt: { gte: monthStart } } });
}

/**
 * Sends a WhatsApp message on behalf of a gym. Everything goes out from the platform's own
 * number (gyms don't need a gateway account), prefixed with the gym's name, and counts against the
 * gym plan's monthly WhatsApp allowance.
 */
export async function sendGymWhatsapp(
  gymId: string,
  opts: { to: string; message: string; type: string; memberId: string },
): Promise<SendResult> {
  const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { name: true, saasPlan: { select: { maxWhatsappPerMonth: true } } } });
  const gateway = platformGateway();

  let result: SendResult;
  let status: "SENT" | "FAILED" | "SKIPPED" | "LIMIT";
  if (!gym || !gateway) {
    result = skippedSend(opts.to, opts.message);
    status = "SKIPPED";
  } else if ((await gymWhatsappUsage(gymId)) >= gym.saasPlan.maxWhatsappPerMonth) {
    console.log(`[whatsapp:limit] gym ${gymId} reached its monthly allowance, not sending to ${opts.to}`);
    result = { ok: false, skipped: true, error: "Monthly WhatsApp limit reached", providerResponse: { limit: true } };
    status = "LIMIT";
  } else {
    result = await sendWithGateway(gateway.provider, gateway.apiKey, opts.to, `*${gym.name}*\n${opts.message}`);
    status = result.ok ? "SENT" : "FAILED";
  }

  await prisma.notificationLog.create({
    data: { gymId, memberId: opts.memberId, type: opts.type, channel: "whatsapp", status },
  });

  return result;
}

/** Sends a platform-level WhatsApp message (billing reminders, payment failures) to a gym owner. */
export async function sendPlatformWhatsapp(opts: { to: string; message: string }): Promise<SendResult> {
  const gateway = platformGateway();
  if (!gateway) return skippedSend(opts.to, opts.message);
  return sendWithGateway(gateway.provider, gateway.apiKey, opts.to, opts.message);
}
