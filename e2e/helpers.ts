import { APIRequestContext, Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { buildQrToken } from "../src/lib/qr";

export const prisma = new PrismaClient();

export async function superadminLoginUI(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/superadmin/login`);
  await page.getByLabel("Email").fill("superadmin@test.local");
  await page.getByLabel("Password").fill("superadmin-pass-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseURL}/superadmin/dashboard`);
  await page.goto(`${baseURL}/superadmin/gyms`);
}

export async function staffLoginUI(page: Page, baseURL: string, slug: string, email: string, password: string) {
  await page.goto(`${baseURL}/${slug}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Logs in via the API and returns the session cookie header value for use with `request`. */
export async function staffLoginAPI(
  request: APIRequestContext,
  baseURL: string,
  slug: string,
  email: string,
  password: string,
) {
  const res = await request.post(`${baseURL}/api/${slug}/staff-login`, {
    data: { email, password },
  });
  if (!res.ok()) throw new Error(`staff login failed: ${res.status()} ${await res.text()}`);
  return res;
}

export async function buildTokenForMember(memberId: string) {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  return buildQrToken({ gymId: member.gymId, memberId: member.id, issuedAt: Date.now() }, member.qrSecret);
}
