import { prisma } from "./prisma";
import { decrypt } from "./crypto";

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

/** Sends a WhatsApp message on behalf of a specific gym, using that gym's own gateway config. */
export async function sendGymWhatsapp(
  gymId: string,
  opts: { to: string; message: string; type: string; memberId: string },
): Promise<SendResult> {
  const config = await prisma.whatsappSenderConfig.findUnique({ where: { gymId } });

  let result: SendResult;
  if (!config || !config.isActive) {
    result = skippedSend(opts.to, opts.message);
  } else {
    result = await sendWithGateway(config.gatewayProvider as GatewayProvider, decrypt(config.apiKeyEncrypted), opts.to, opts.message);
  }

  await prisma.notificationLog.create({
    data: {
      gymId,
      memberId: opts.memberId,
      type: opts.type,
      channel: "whatsapp",
      status: result.skipped ? "SKIPPED" : result.ok ? "SENT" : "FAILED",
    },
  });

  return result;
}

/** Sends a platform-level WhatsApp message (billing reminders, payment failures) to a gym owner. */
export async function sendPlatformWhatsapp(opts: { to: string; message: string }): Promise<SendResult> {
  const apiKey = process.env.PLATFORM_WHATSAPP_API_KEY;
  if (!apiKey) return skippedSend(opts.to, opts.message);

  const provider = (process.env.PLATFORM_WHATSAPP_PROVIDER ?? "fonnte") as GatewayProvider;
  return sendWithGateway(provider, apiKey, opts.to, opts.message);
}
