import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

interface SendResult {
  ok: boolean;
  providerResponse?: unknown;
  error?: string;
}

async function sendViaFonnte(apiKey: string, to: string, message: string): Promise<SendResult> {
  try {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ target: to, message }),
    });
    const body = await res.json().catch(() => undefined);
    return { ok: res.ok, providerResponse: body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendViaWablas(apiKey: string, to: string, message: string): Promise<SendResult> {
  try {
    const res = await fetch("https://console.wablas.com/api/send-message", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ phone: to, message }),
    });
    const body = await res.json().catch(() => undefined);
    return { ok: res.ok, providerResponse: body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function stubSend(to: string, message: string): SendResult {
  console.log(`[whatsapp:stub] no gateway credentials configured — would send to ${to}: ${message}`);
  return { ok: true, providerResponse: { stub: true } };
}

/** Sends a WhatsApp message on behalf of a specific gym, using that gym's own gateway config. */
export async function sendGymWhatsapp(
  gymId: string,
  opts: { to: string; message: string; type: string; memberId: string },
): Promise<SendResult> {
  const config = await prisma.whatsappSenderConfig.findUnique({ where: { gymId } });

  let result: SendResult;
  if (!config || !config.isActive) {
    result = stubSend(opts.to, opts.message);
  } else {
    const apiKey = decrypt(config.apiKeyEncrypted);
    result =
      config.gatewayProvider === "wablas"
        ? await sendViaWablas(apiKey, opts.to, opts.message)
        : await sendViaFonnte(apiKey, opts.to, opts.message);
  }

  await prisma.notificationLog.create({
    data: {
      gymId,
      memberId: opts.memberId,
      type: opts.type,
      channel: "whatsapp",
      status: result.ok ? "SENT" : "FAILED",
    },
  });

  return result;
}

/** Sends a platform-level WhatsApp message (billing reminders, payment failures) to a gym owner. */
export async function sendPlatformWhatsapp(opts: {
  to: string;
  message: string;
}): Promise<SendResult> {
  const apiKey = process.env.PLATFORM_WHATSAPP_API_KEY;
  if (!apiKey) return stubSend(opts.to, opts.message);

  const provider = process.env.PLATFORM_WHATSAPP_PROVIDER ?? "fonnte";
  return provider === "wablas"
    ? sendViaWablas(apiKey, opts.to, opts.message)
    : sendViaFonnte(apiKey, opts.to, opts.message);
}
