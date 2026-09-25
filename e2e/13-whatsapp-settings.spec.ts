import { test, expect, type APIRequestContext } from "@playwright/test";
import { prisma } from "./helpers";
import { decrypt } from "../src/lib/crypto";

async function loginOwner(request: APIRequestContext, baseURL: string, slug: string, email: string) {
  const res = await request.post(`${baseURL}/api/g/${slug}/staff-login`, { data: { email, password: "owner-pass-123" } });
  expect(res.ok()).toBeTruthy();
}

test("owner saves WhatsApp settings; the key is stored encrypted and kept when editing other fields", async ({ request, baseURL }) => {
  await loginOwner(request, baseURL!, "test-gym-a", "owner-a@test.local");
  const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });

  // A brand-new setup needs a key.
  const noKey = await request.post(`${baseURL}/api/g/test-gym-a/whatsapp`, {
    data: { provider: "fonnte", senderNumber: "081200001111", isActive: true },
  });
  expect(noKey.status()).toBe(400);

  const saved = await request.post(`${baseURL}/api/g/test-gym-a/whatsapp`, {
    data: { provider: "fonnte", senderNumber: "081200001111", apiKey: "secret-token-12345", isActive: true },
  });
  expect(saved.ok()).toBeTruthy();

  const row = await prisma.whatsappSenderConfig.findUniqueOrThrow({ where: { gymId: gym.id } });
  expect(row.apiKeyEncrypted.startsWith("v1:")).toBe(true);
  expect(row.apiKeyEncrypted).not.toContain("secret-token");
  expect(decrypt(row.apiKeyEncrypted)).toBe("secret-token-12345");

  // Editing without a new key keeps the old one.
  const edit = await request.post(`${baseURL}/api/g/test-gym-a/whatsapp`, {
    data: { provider: "wablas", senderNumber: "081200002222", isActive: false },
  });
  expect(edit.ok()).toBeTruthy();
  const after = await prisma.whatsappSenderConfig.findUniqueOrThrow({ where: { gymId: gym.id } });
  expect(after.gatewayProvider).toBe("wablas");
  expect(after.isActive).toBe(false);
  expect(decrypt(after.apiKeyEncrypted)).toBe("secret-token-12345");
});

test("test message goes only to the owner's own number, reports gateway rejections, and is rate limited", async ({ request, baseURL }) => {
  await loginOwner(request, baseURL!, "test-gym-a", "owner-a@test.local");
  const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  await prisma.gym.update({ where: { id: gym.id }, data: { settings: {} } }); // clear any cooldown

  // A gateway that rejects the token: reported clearly, not swallowed.
  await request.post(`${baseURL}/api/g/test-gym-a/whatsapp`, {
    data: { provider: "fonnte", senderNumber: "081200001111", apiKey: "bad-token-000000", isActive: true },
  });
  const rejected = await request.post(`${baseURL}/api/g/test-gym-a/whatsapp/test`, { data: { phone: "081299990000" } });
  const rejectedBody = await rejected.json();
  expect(rejectedBody.ok).toBe(false);
  expect(rejectedBody.error).toContain("rejected");

  // The number given is saved to the owner's profile, and a second test right away is refused.
  const owner = await prisma.staffUser.findUniqueOrThrow({ where: { email: "owner-a@test.local" } });
  expect(owner.phone).toBe("081299990000");
  expect((await request.post(`${baseURL}/api/g/test-gym-a/whatsapp/test`, { data: {} })).status()).toBe(429);

  // With a good key and the cooldown cleared, it sends.
  await request.post(`${baseURL}/api/g/test-gym-a/whatsapp`, {
    data: { provider: "fonnte", senderNumber: "081200001111", apiKey: "good-token-000000", isActive: true },
  });
  await prisma.gym.update({ where: { id: gym.id }, data: { settings: {} } });
  const ok = await request.post(`${baseURL}/api/g/test-gym-a/whatsapp/test`, { data: {} });
  expect((await ok.json()).ok).toBe(true);
});

test("WhatsApp settings are owner-only and tenant-scoped; unconfigured gyms log messages as skipped", async ({ request, baseURL }) => {
  // Not logged in.
  const anon = await request.post(`${baseURL}/api/g/test-gym-a/whatsapp`, {
    data: { provider: "fonnte", senderNumber: "081200003333", apiKey: "another-token-1", isActive: true },
  });
  expect(anon.status()).toBe(401);

  // Gym B's owner can't configure gym A.
  await loginOwner(request, baseURL!, "test-gym-b", "owner-b@test.local");
  const cross = await request.post(`${baseURL}/api/g/test-gym-a/whatsapp`, {
    data: { provider: "fonnte", senderNumber: "081200003333", apiKey: "another-token-1", isActive: true },
  });
  expect(cross.status()).toBe(401);

  // Gym B has no gateway: a message is not sent and is recorded as SKIPPED, not SENT.
  const gymB = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-b" } });
  expect(await prisma.whatsappSenderConfig.findUnique({ where: { gymId: gymB.id } })).toBeNull();
  const member = await prisma.member.findFirstOrThrow({ where: { gymId: gymB.id } });
  const { sendGymWhatsapp } = await import("../src/lib/whatsapp");
  const result = await sendGymWhatsapp(gymB.id, { to: "081200004444", message: "hi", type: "e2e_probe", memberId: member.id });
  expect(result.skipped).toBe(true);
  const log = await prisma.notificationLog.findFirstOrThrow({ where: { gymId: gymB.id, type: "e2e_probe" } });
  expect(log.status).toBe("SKIPPED");
});
