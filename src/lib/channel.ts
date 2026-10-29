import type { Channel } from "./notify";

/** The channel a person picked on a send button (`{ "channel": "whatsapp" | "email" }`), or undefined. */
export async function readChannel(req: Request): Promise<Channel | undefined> {
  const body = (await req.json().catch(() => null)) as { channel?: unknown } | null;
  return body?.channel === "whatsapp" || body?.channel === "email" ? body.channel : undefined;
}
