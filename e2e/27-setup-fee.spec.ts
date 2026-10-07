import { test, expect, type APIRequestContext } from "@playwright/test";
import { prisma, superadminLoginUI, staffLoginUI } from "./helpers";

let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

async function superadminLoginAPI(request: APIRequestContext, baseURL: string) {
  const res = await request.post(`${baseURL}/api/superadmin/login`, {
    data: { email: "superadmin@test.local", password: "superadmin-pass-123" },
  });
  if (!res.ok()) throw new Error(`superadmin login failed: ${res.status()} ${await res.text()}`);
}

async function createGym(request: APIRequestContext, baseURL: string, extra: Record<string, unknown>) {
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { name: "Starter Monthly" } });
  const slug = uniq("fee");
  const res = await request.post(`${baseURL}/api/superadmin/gyms`, {
    data: {
      gymName: `Fee ${slug}`,
      slug,
      saasPlanId: plan.id,
      ownerName: "Fee Owner",
      ownerEmail: `owner-${slug}@test.local`,
      ownerTempPassword: "owner-pass-123",
      ...extra,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { gymId } = (await res.json()) as { gymId: string };
  return { gymId, slug, ownerEmail: `owner-${slug}@test.local` };
}

test("an unpaid setup fee is recorded, shown, marked paid once, and never touches billing", async ({ page, request, baseURL }) => {
  await superadminLoginAPI(request, baseURL!);
  const { gymId, slug, ownerEmail } = await createGym(request, baseURL!, { setupFee: 2_000_000 });

  const before = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  const fee = await prisma.platformPayment.findFirstOrThrow({ where: { gymId, kind: "SETUP" } });
  expect(fee.status).toBe("PENDING");
  expect(fee.provider).toBe("manual");
  expect(Number(fee.amount)).toBe(2_000_000);
  expect(fee.externalInvoiceId).toBeNull();

  // The gyms list shows it as owed, with the action to settle it.
  await superadminLoginUI(page, baseURL!);
  const row = page.locator("tr", { hasText: slug });
  await expect(row.getByText("Rp 2.000.000")).toBeVisible();
  await expect(row.getByText("unpaid")).toBeVisible();
  await row.getByRole("button", { name: "Setup fee paid" }).click();
  await expect(row.getByText("paid", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Setup fee paid" })).toHaveCount(0);

  const paid = await prisma.platformPayment.findUniqueOrThrow({ where: { id: fee.id } });
  expect(paid.status).toBe("PAID");
  expect(paid.paidAt).not.toBeNull();

  // Settling a one-time fee is not a subscription payment: the billing date and plan are untouched.
  const after = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  expect(after.nextBillingDate?.getTime()).toBe(before.nextBillingDate?.getTime());
  expect(after.saasPlanId).toBe(before.saasPlanId);
  expect(after.subscriptionStatus).toBe(before.subscriptionStatus); // a setup fee never changes the subscription status (still on trial)

  // Marking it again finds nothing owed; no second payment row appears.
  const again = await request.post(`${baseURL}/api/superadmin/gyms/${gymId}/setup-fee-paid`);
  expect(again.status()).toBe(409);
  expect(await prisma.platformPayment.count({ where: { gymId, kind: "SETUP" } })).toBe(1);

  const audit = await prisma.auditLog.findMany({ where: { gymId, action: "SETUP_FEE_PAID" } });
  expect(audit).toHaveLength(1);

  // The owner sees it in their invoice history, labelled as what it is.
  await staffLoginUI(page, baseURL!, slug, ownerEmail, "owner-pass-123");
  await page.waitForURL(`${baseURL}/${slug}/dashboard`);
  await page.goto(`${baseURL}/${slug}/billing`);
  const invoiceRow = page.locator("tr", { hasText: "Setup fee" });
  await expect(invoiceRow.getByText("Rp 2.000.000")).toBeVisible();
  await expect(invoiceRow.getByText("PAID")).toBeVisible();
});

test("a setup fee marked paid at creation is PAID at once; no fee means no payment row", async ({ request, baseURL }) => {
  await superadminLoginAPI(request, baseURL!);

  const prepaid = await createGym(request, baseURL!, { setupFee: 500_000, setupFeePaid: true });
  const fee = await prisma.platformPayment.findFirstOrThrow({ where: { gymId: prepaid.gymId, kind: "SETUP" } });
  expect(fee.status).toBe("PAID");
  expect(fee.paidAt).not.toBeNull();
  const marked = await request.post(`${baseURL}/api/superadmin/gyms/${prepaid.gymId}/setup-fee-paid`);
  expect(marked.status()).toBe(409);

  const free = await createGym(request, baseURL!, {});
  expect(await prisma.platformPayment.count({ where: { gymId: free.gymId } })).toBe(0);

  // "Already paid" without a fee is meaningless and must not create a zero-amount payment.
  const zero = await createGym(request, baseURL!, { setupFee: 0, setupFeePaid: true });
  expect(await prisma.platformPayment.count({ where: { gymId: zero.gymId } })).toBe(0);

  // Garbage is rejected before it reaches the database.
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { name: "Starter Monthly" } });
  const bad = await request.post(`${baseURL}/api/superadmin/gyms`, {
    data: {
      gymName: "Bad fee",
      slug: uniq("badfee"),
      saasPlanId: plan.id,
      ownerName: "Owner",
      ownerEmail: `${uniq("bad")}@test.local`,
      ownerTempPassword: "owner-pass-123",
      setupFee: -1,
    },
  });
  expect(bad.status()).toBe(400);
});
