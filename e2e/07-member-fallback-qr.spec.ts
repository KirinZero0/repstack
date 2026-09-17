import { test, expect } from "@playwright/test";
import { staffLoginUI, prisma } from "./helpers";
import { generateMagicToken } from "../src/lib/magicLink";

test("owner-triggered fallback link lets a member view /my-qr without a session", async ({
  page,
  baseURL,
}) => {
  const member = await prisma.member.findUniqueOrThrow({ where: { email: "active-member@test.local" } });

  await staffLoginUI(page, baseURL!, "test-gym-a", "owner-a@test.local", "owner-pass-123");
  await page.waitForURL(`${baseURL}/g/test-gym-a/dashboard`);

  await page.goto(`${baseURL}/g/test-gym-a/members`);
  const row = page.locator("tr", { hasText: "Active Member" });
  await row.getByRole("button", { name: "Resend QR link" }).click();
  await expect(row.getByRole("button", { name: "Sent" })).toBeVisible();

  const link = await prisma.magicLink.findFirstOrThrow({
    where: { memberId: member.id, purpose: "qr_fallback" },
    orderBy: { createdAt: "desc" },
  });
  expect(link.usedAt).toBeNull();

  // As with the activation flow, reconstruct the raw token deterministically for the test
  // since only its hash is persisted.
  const { token, tokenHash } = generateMagicToken();
  await prisma.magicLink.update({ where: { id: link.id }, data: { tokenHash } });

  // Fresh browser context = no member session cookie.
  const context = await page.context().browser()!.newContext();
  const freshPage = await context.newPage();
  await freshPage.goto(`${baseURL}/my-qr?token=${token}`);
  await expect(freshPage.getByText("Active Member")).toBeVisible();
  await expect(freshPage.locator("img[alt='Your check-in QR code']")).toBeVisible();
  await context.close();
});
