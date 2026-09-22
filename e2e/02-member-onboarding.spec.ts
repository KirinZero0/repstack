import { test, expect } from "@playwright/test";
import path from "path";
import { staffLoginUI, prisma } from "./helpers";

test("owner adds a member, member activates, member can log in", async ({ page, baseURL }) => {
  await staffLoginUI(page, baseURL!, "test-gym-a", "owner-a@test.local", "owner-pass-123");
  await page.waitForURL(`${baseURL}/g/test-gym-a/dashboard`);

  await page.goto(`${baseURL}/g/test-gym-a/members`);
  await page.getByRole("button", { name: "+ Add member" }).click();

  const newEmail = `onboard-${Date.now()}@test.local`;
  await page.getByLabel("Full name").fill("Onboarded Member");
  await page.getByLabel("Email (login)").fill(newEmail);
  await page.getByLabel("WhatsApp phone").fill("081299998888");
  await page.getByRole("button", { name: "Add member" }).click();

  await expect(page.getByText("Onboarded Member")).toBeVisible();

  const member = await prisma.member.findUniqueOrThrow({ where: { email: newEmail } });
  expect(member.status).toBe("PENDING_PAYMENT");
  expect(member.passwordHash).toBeNull();

  const magicLink = await prisma.magicLink.findFirstOrThrow({
    where: { memberId: member.id, purpose: "activate" },
  });
  expect(magicLink.usedAt).toBeNull();

  // Playwright can't decrypt tokenHash back to the raw token (one-way hash) — reconstruct via
  // the same code path the app uses: generate a fresh activate link directly for the test.
  const { generateMagicToken } = await import("../src/lib/magicLink");
  const { token, tokenHash } = generateMagicToken();
  await prisma.magicLink.update({ where: { id: magicLink.id }, data: { tokenHash } });

  await page.goto(`${baseURL}/activate/${token}`);
  await expect(page.getByText("Onboarded Member")).toBeVisible();

  await page.locator("#password").fill("newpassword123");
  await page.locator("#confirmPassword").fill("newpassword123");
  await page.locator("#photo").setInputFiles(path.join(__dirname, "fixtures", "test-photo.jpg"));
  await page.getByRole("button", { name: "Activate account" }).click();

  await page.waitForURL(`${baseURL}/g/test-gym-a/login`, { timeout: 5000 });

  await page.locator("#email").fill(newEmail);
  await page.locator("#password").fill("newpassword123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseURL}/my`);

  const activated = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(activated.passwordHash).not.toBeNull();
});
