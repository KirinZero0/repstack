import crypto from "crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import {
  buildSnapRequest,
  parseMidtransTime,
  recordIdFromOrderId,
  stateFromMidtrans,
  verifyMidtransSignature,
} from "../src/lib/midtrans";
import { activeProvider, createInvoice, paymentProviderEnum, platformProviderName } from "../src/lib/gateway";

const DAY = 24 * 60 * 60 * 1000;
const SERVER_KEY = () => process.env.MIDTRANS_SERVER_KEY!;
let seq = 0;
const suffix = () => `${Date.now().toString(36)}${seq++}`;

/** A notification the way Midtrans sends it, signed with the server key. */
function notification(over: Record<string, string>) {
  const base: Record<string, string> = { status_code: "200", gross_amount: "250000.00", transaction_status: "settlement", transaction_id: `tx-${suffix()}`, ...over };
  const signature = crypto.createHash("sha512").update(`${base.order_id}${base.status_code}${base.gross_amount}${SERVER_KEY()}`).digest("hex");
  return { ...base, signature_key: signature };
}

const send = (request: APIRequestContext, baseURL: string, body: object) => request.post(`${baseURL}/api/webhooks/midtrans`, { data: body });

async function pendingMemberPayment(email: string) {
  const member = await prisma.member.findUniqueOrThrow({ where: { email } });
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: member.gymId } });
  const payment = await prisma.payment.create({
    data: { gymId: member.gymId, memberId: member.id, planId: plan.id, provider: "MIDTRANS", amount: 250000, status: "PENDING" },
  });
  return { member, plan, payment, orderId: `${payment.id}~${suffix()}` };
}

test("a settled Midtrans payment extends the membership once, and a bad signature changes nothing", async ({ request, baseURL }) => {
  const { member, payment, orderId } = await pendingMemberPayment("active-member@test.local");
  const before = member.membershipExpiry!;

  const forged = { ...notification({ order_id: orderId }), signature_key: "0".repeat(128) };
  expect((await send(request, baseURL!, forged)).status()).toBe(401);
  expect((await send(request, baseURL!, { order_id: orderId, transaction_status: "settlement" })).status()).toBe(401);
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");

  const good = notification({ order_id: orderId, settlement_time: "2026-09-27 10:00:00" });
  expect((await send(request, baseURL!, good)).ok()).toBeTruthy();
  const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  expect(paid.status).toBe("PAID");
  expect(paid.paidAt!.toISOString()).toBe("2026-09-27T03:00:00.000Z"); // 10:00 in UTC+7
  const after = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(after.membershipExpiry!.getTime()).toBeGreaterThan(before.getTime() + 25 * DAY);

  // Midtrans repeats notifications; the second one must not extend it again.
  expect((await send(request, baseURL!, good)).ok()).toBeTruthy();
  expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).membershipExpiry!.getTime()).toBe(after.membershipExpiry!.getTime());
});

test("only settled and expired notifications act; held, pending and failed ones are acknowledged and ignored", async ({ request, baseURL }) => {
  const cases: { over: Record<string, string>; expected: "PENDING" | "PAID" | "EXPIRED" }[] = [
    { over: { transaction_status: "pending" }, expected: "PENDING" },
    { over: { transaction_status: "deny" }, expected: "PENDING" },
    { over: { transaction_status: "failure" }, expected: "PENDING" },
    { over: { transaction_status: "capture", fraud_status: "challenge" }, expected: "PENDING" },
    { over: { transaction_status: "capture", fraud_status: "accept" }, expected: "PAID" },
    { over: { transaction_status: "expire" }, expected: "EXPIRED" },
  ];
  for (const c of cases) {
    const { payment, orderId } = await pendingMemberPayment("duplicate-scan-member@test.local");
    const res = await send(request, baseURL!, notification({ order_id: orderId, ...c.over }));
    expect(res.ok(), JSON.stringify(c.over)).toBeTruthy();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, JSON.stringify(c.over)).toBe(c.expected);
  }

  // A correctly signed notification for an order we don't know is refused.
  const unknown = await send(request, baseURL!, notification({ order_id: `${crypto.randomUUID()}~abc` }));
  expect(unknown.status()).toBe(404);
});

test("a settled Midtrans payment creates the gym for a paid signup and renews a subscription", async ({ request, baseURL }) => {
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true, billingInterval: "monthly" } });
  const stamp = suffix();
  const signup = await prisma.gymSignup.create({
    data: {
      gymName: "Midtrans Gym",
      slug: `midtrans-${stamp}`,
      ownerName: "Mid Owner",
      ownerEmail: `mid-${stamp}@signup.test`,
      ownerPhone: "081200007777",
      passwordHash: await bcrypt.hash("long-enough-1", 10),
      saasPlanId: plan.id,
      externalInvoiceId: `x~${stamp}`,
    },
  });
  expect((await send(request, baseURL!, notification({ order_id: `${signup.id}~${stamp}`, gross_amount: "300000.00" }))).ok()).toBeTruthy();
  const done = await prisma.gymSignup.findUniqueOrThrow({ where: { id: signup.id } });
  expect(done.status).toBe("COMPLETED");
  const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: `midtrans-${stamp}` } });
  expect(gym.subscriptionStatus).toBe("ACTIVE");

  const renewal = await prisma.platformPayment.create({
    data: { gymId: gym.id, saasPlanId: plan.id, provider: "midtrans", amount: 300000, status: "PENDING" },
  });
  const billingBefore = gym.nextBillingDate!.getTime();
  expect((await send(request, baseURL!, notification({ order_id: `${renewal.id}~${stamp}`, gross_amount: "300000.00" }))).ok()).toBeTruthy();
  expect((await prisma.platformPayment.findUniqueOrThrow({ where: { id: renewal.id } })).status).toBe("PAID");
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: gym.id } })).nextBillingDate!.getTime()).toBeGreaterThan(billingBefore + 25 * DAY);
});

test("Midtrans request and signature helpers behave as the API expects", () => {
  // Whole rupiah, one item that adds up to the total, names of at most 50 characters.
  const orderId = "3f2b8a52-0000-4000-8000-000000000000~ab12cd";
  const req = buildSnapRequest(
    { externalId: "x", amount: 250000.4, description: "Monthly membership at a gym with a really quite long name indeed", payerEmail: "a@b.co", successRedirectUrl: "https://x.test/ok" },
    orderId,
  );
  expect(req.transaction_details).toEqual({ order_id: orderId, gross_amount: 250000 });
  expect(req.item_details).toHaveLength(1);
  expect(req.item_details[0].price * req.item_details[0].quantity).toBe(req.transaction_details.gross_amount);
  expect(req.item_details[0].name.length).toBeLessThanOrEqual(50);
  expect(orderId.length).toBeLessThanOrEqual(50);
  expect(orderId).toMatch(/^[A-Za-z0-9_\-~.]+$/);
  expect(req.callbacks).toEqual({ finish: "https://x.test/ok" });
  expect(buildSnapRequest({ externalId: "x", amount: 1000, description: "d" }, "o")).not.toHaveProperty("customer_details");

  expect(recordIdFromOrderId("abc-123~ff00aa")).toBe("abc-123");
  expect(recordIdFromOrderId("abc-123")).toBe("abc-123");

  expect(stateFromMidtrans("settlement")).toBe("PAID");
  expect(stateFromMidtrans("capture")).toBe("PAID");
  expect(stateFromMidtrans("capture", "challenge")).toBe("PENDING");
  expect(stateFromMidtrans("expire")).toBe("EXPIRED");
  expect(stateFromMidtrans("cancel")).toBe("EXPIRED");
  expect(stateFromMidtrans("pending")).toBe("PENDING");
  expect(stateFromMidtrans(undefined)).toBe("PENDING");

  expect(parseMidtransTime("2026-09-27 10:00:00")?.toISOString()).toBe("2026-09-27T03:00:00.000Z");
  expect(parseMidtransTime("garbage")).toBeUndefined();
  expect(parseMidtransTime(undefined)).toBeUndefined();

  const signed = notification({ order_id: "o1" });
  expect(verifyMidtransSignature(signed)).toBe(true);
  expect(verifyMidtransSignature({ ...signed, gross_amount: "1.00" })).toBe(false);
  expect(verifyMidtransSignature({ ...signed, signature_key: undefined })).toBe(false);
});

test("PAYMENT_PROVIDER picks the provider for new invoices, and defaults to Xendit", async () => {
  const saved = process.env.PAYMENT_PROVIDER;
  try {
    delete process.env.PAYMENT_PROVIDER;
    expect(activeProvider()).toBe("xendit");
    expect(paymentProviderEnum()).toBe("XENDIT");
    expect(platformProviderName()).toBe("xendit");

    process.env.PAYMENT_PROVIDER = "midtrans";
    expect(activeProvider()).toBe("midtrans");
    expect(paymentProviderEnum()).toBe("MIDTRANS");
    expect(platformProviderName()).toBe("midtrans");

    process.env.PAYMENT_PROVIDER = "something-else";
    expect(activeProvider()).toBe("xendit");

    // In test mode no provider is called, whichever one is selected.
    process.env.PAYMENT_PROVIDER = "midtrans";
    const invoice = await createInvoice({ externalId: "abc", amount: 1000, description: "d" });
    expect(invoice.id).toBe("mock_abc");
  } finally {
    if (saved === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = saved;
  }
});
