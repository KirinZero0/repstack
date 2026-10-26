import { test, expect, type APIRequestContext } from "@playwright/test";
import { prisma } from "./helpers";
import { discountAmount, invoiceTotals, lineNet } from "../src/lib/invoiceMath";

let seq = 0;

/** The superadmin signs in from its own forwarded IP so the suite-wide login throttle can't interfere. */
async function superadmin(ctx: APIRequestContext, baseURL: string) {
  const headers = { "x-forwarded-for": `10.3.${seq++ % 250}.${Math.floor(Math.random() * 250)}` };
  const res = await ctx.post(`${baseURL}/api/superadmin/login`, { data: { email: "superadmin@test.local", password: "superadmin-pass-123" }, headers });
  expect(res.ok()).toBeTruthy();
}

const base = {
  gymName: "Discount Gym",
  billToName: "Dewi Owner",
  issueDate: "2026-10-26",
  items: [
    { description: "Setup fee", quantity: 2, unitPrice: 500_000 },
    { description: "Training", quantity: 1, unitPrice: 250_000 },
  ], // subtotal 1,250,000
};

const create = (ctx: APIRequestContext, baseURL: string, extra: object = {}) =>
  ctx.post(`${baseURL}/api/superadmin/invoices`, { data: { ...base, ...extra } });

test("the discount maths: percentages round to whole rupiah and nothing goes below zero", () => {
  expect(discountAmount(1_250_000, { type: "PERCENT", value: 10 })).toBe(125_000);
  expect(discountAmount(100_001, { type: "PERCENT", value: 10 })).toBe(10_000); // 10,000.1 rounds down
  expect(discountAmount(100_005, { type: "PERCENT", value: 10 })).toBe(10_001); // 10,000.5 rounds up
  expect(discountAmount(1_000_000, { type: "AMOUNT", value: 50_000 })).toBe(50_000);
  expect(discountAmount(1_000_000, { type: "AMOUNT", value: 9_000_000 })).toBe(1_000_000); // capped at the subtotal
  expect(discountAmount(1_000_000, { type: "PERCENT", value: 100 })).toBe(1_000_000);
  expect(discountAmount(0, { type: "PERCENT", value: 10 })).toBe(0);
  expect(discountAmount(500, null)).toBe(0);
  expect(invoiceTotals(base.items, { type: "PERCENT", value: 10 })).toEqual({ gross: 1_250_000, itemDiscounts: 0, subtotal: 1_250_000, discountAmount: 125_000, total: 1_125_000 });

  // Line discounts come first; a whole-invoice discount then applies to what is left.
  const lines = [
    { description: "A", quantity: 2, unitPrice: 500_000, discount: { type: "PERCENT" as const, value: 10 } }, // 1,000,000 − 100,000
    { description: "B", quantity: 1, unitPrice: 300_000, discount: { type: "AMOUNT" as const, value: 50_000 } }, // 300,000 − 50,000
    { description: "C", quantity: 1, unitPrice: 250_000 },
  ];
  expect(lineNet(lines[0])).toBe(900_000);
  expect(lineNet(lines[1])).toBe(250_000);
  expect(invoiceTotals(lines)).toEqual({ gross: 1_550_000, itemDiscounts: 150_000, subtotal: 1_400_000, discountAmount: 0, total: 1_400_000 });
  expect(invoiceTotals(lines, { type: "PERCENT", value: 10 })).toEqual({ gross: 1_550_000, itemDiscounts: 150_000, subtotal: 1_400_000, discountAmount: 140_000, total: 1_260_000 });
  expect(lineNet({ description: "free", quantity: 1, unitPrice: 0, discount: { type: "PERCENT", value: 50 } })).toBe(0);
});

test("a percentage discount is worked out on the server and printed on the invoice", async ({ request, baseURL, page }) => {
  await superadmin(request, baseURL!);
  const res = await create(request, baseURL!, { discount: { type: "PERCENT", value: 10, label: "Early bird" }, total: 1 }); // a forged total is ignored
  expect(res.status()).toBe(201);
  const { id } = await res.json();

  const row = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  expect(Number(row.subtotal)).toBe(1_250_000);
  expect(row.discountType).toBe("PERCENT");
  expect(Number(row.discountValue)).toBe(10);
  expect(row.discountLabel).toBe("Early bird");
  expect(Number(row.discountAmount)).toBe(125_000);
  expect(Number(row.total)).toBe(1_125_000); // what is payable

  await superadmin(page.request, baseURL!);
  await page.goto(`${baseURL}/superadmin/invoices/${id}`);
  await expect(page.getByTestId("invoice-subtotal")).toHaveText("Rp 1.250.000");
  await expect(page.getByTestId("invoice-discount")).toHaveText("− Rp 125.000");
  await expect(page.getByText("Discount (Early bird, 10%)")).toBeVisible();
  await expect(page.getByText("Total due")).toBeVisible();
  await expect(page.getByText("Rp 1.125.000")).toBeVisible();

  // The invoice list shows what is owed, after the discount.
  await page.goto(`${baseURL}/superadmin/invoices`);
  await expect(page.getByText("Rp 1.125.000").first()).toBeVisible();
});

test("a fixed-amount discount, a full discount, and no discount", async ({ request, baseURL, page }) => {
  await superadmin(request, baseURL!);

  const amountRes = await create(request, baseURL!, { discount: { type: "AMOUNT", value: 50_000 } });
  expect(amountRes.status()).toBe(201);
  const amount = await prisma.invoice.findUniqueOrThrow({ where: { id: (await amountRes.json()).id } });
  expect([Number(amount.discountAmount), Number(amount.total), amount.discountLabel]).toEqual([50_000, 1_200_000, ""]);

  const freeRes = await create(request, baseURL!, { discount: { type: "PERCENT", value: 100, label: "Founding partner" } });
  expect(freeRes.status()).toBe(201);
  const free = await prisma.invoice.findUniqueOrThrow({ where: { id: (await freeRes.json()).id } });
  expect([Number(free.discountAmount), Number(free.total)]).toEqual([1_250_000, 0]);

  const plainRes = await create(request, baseURL!);
  expect(plainRes.status()).toBe(201);
  const plain = await prisma.invoice.findUniqueOrThrow({ where: { id: (await plainRes.json()).id } });
  expect([plain.discountType, Number(plain.discountAmount), Number(plain.subtotal), Number(plain.total)]).toEqual([null, 0, 1_250_000, 1_250_000]);

  // No discount: the invoice looks exactly as before, just "Total".
  await superadmin(page.request, baseURL!);
  await page.goto(`${baseURL}/superadmin/invoices/${plain.id}`);
  await expect(page.getByText("Total", { exact: true })).toBeVisible();
  await expect(page.getByTestId("invoice-discount")).toHaveCount(0);
  await expect(page.getByText("Total due")).toHaveCount(0);
});

test("an invoice made before discounts existed still shows normally", async ({ page, baseURL }) => {
  const old = await prisma.invoice.create({
    data: {
      number: `INV-OLD-${Date.now()}-${seq++}`, gymName: "Old Gym", billToName: "Old Owner", items: [{ description: "Setup", quantity: 1, unitPrice: 300_000 }],
      total: 300_000, issueDate: new Date(), createdById: (await prisma.superadmin.findFirstOrThrow()).id,
    },
  });
  await superadmin(page.request, baseURL!);
  await page.goto(`${baseURL}/superadmin/invoices/${old.id}`);
  await expect(page.getByText("Rp 300.000").first()).toBeVisible();
  await expect(page.getByTestId("invoice-discount")).toHaveCount(0);
});

test("bad discounts are refused, and only a logged-in superadmin can issue invoices", async ({ request, baseURL, playwright }) => {
  const anon = await playwright.request.newContext();
  expect((await create(anon, baseURL!, { discount: { type: "PERCENT", value: 10 } })).status()).toBe(401);

  await superadmin(request, baseURL!);
  const bad: [object, string][] = [
    [{ type: "PERCENT", value: 0 }, "greater than 0"],
    [{ type: "PERCENT", value: -5 }, "greater than 0"],
    [{ type: "PERCENT", value: 101 }, "more than 100%"],
    [{ type: "AMOUNT", value: 1_250_001 }, "more than the invoice subtotal"],
    [{ type: "AMOUNT", value: 1000.5 }, "whole rupiah"],
    [{ type: "SPECIAL", value: 10 }, ""],
  ];
  for (const [discount, message] of bad) {
    const res = await create(request, baseURL!, { discount });
    expect(res.status(), JSON.stringify(discount)).toBe(400);
    if (message) expect((await res.json()).error).toContain(message);
  }
  // The limit itself is fine: a discount of exactly the subtotal.
  expect((await create(request, baseURL!, { discount: { type: "AMOUNT", value: 1_250_000 } })).status()).toBe(201);
});

const itemsWithDiscounts = [
  { description: "Setup fee", quantity: 2, unitPrice: 500_000, discount: { type: "PERCENT", value: 10 } }, // 1,000,000 → 900,000
  { description: "Training", quantity: 1, unitPrice: 250_000 }, //                                          250,000
  { description: "Annual plan", quantity: 1, unitPrice: 300_000, discount: { type: "AMOUNT", value: 50_000 } }, // → 250,000
]; // gross 1,550,000 · line discounts 150,000 · subtotal 1,400,000

test("each item can have its own discount: worked out on the server and printed per line", async ({ request, baseURL, page }) => {
  await superadmin(request, baseURL!);
  const res = await create(request, baseURL!, { items: itemsWithDiscounts, total: 1 }); // a forged total is ignored
  expect(res.status()).toBe(201);
  const { id } = await res.json();

  const row = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  expect(Number(row.subtotal)).toBe(1_400_000); // after line discounts
  expect(Number(row.discountAmount)).toBe(0); // no whole-invoice discount
  expect(Number(row.total)).toBe(1_400_000);
  const stored = row.items as { description: string; discount?: { type: string; value: number } }[];
  expect(stored[0].discount).toEqual({ type: "PERCENT", value: 10 });
  expect(stored[1].discount).toBeUndefined();
  expect(stored[2].discount).toEqual({ type: "AMOUNT", value: 50_000 });

  await superadmin(page.request, baseURL!);
  await page.goto(`${baseURL}/superadmin/invoices/${id}`);
  const cells = page.getByTestId("line-discount");
  await expect(cells).toHaveCount(3);
  await expect(cells.nth(0)).toHaveText("10% (− Rp 100.000)");
  await expect(cells.nth(1)).toHaveText("");
  await expect(cells.nth(2)).toHaveText("− Rp 50.000"); // a fixed amount is just shown once
  await expect(page.getByText("Rp 900.000")).toBeVisible(); // the first line's net amount
  await expect(page.getByText("Total due")).toBeVisible();
  await expect(page.getByText("Rp 1.400.000").first()).toBeVisible();
  await expect(page.getByTestId("invoice-savings")).toHaveText("You save Rp 150.000");
  await expect(page.getByText("Items before discounts Rp 1.550.000")).toBeVisible();
  await expect(page.getByTestId("invoice-discount")).toHaveCount(0); // no whole-invoice line
});

test("line discounts and a whole-invoice discount stack, in that order", async ({ request, baseURL, page }) => {
  await superadmin(request, baseURL!);
  const res = await create(request, baseURL!, { items: itemsWithDiscounts, discount: { type: "PERCENT", value: 10, label: "Loyalty" } });
  expect(res.status()).toBe(201);
  const { id } = await res.json();
  const row = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  expect([Number(row.subtotal), Number(row.discountAmount), Number(row.total)]).toEqual([1_400_000, 140_000, 1_260_000]); // 10% of the 1,400,000 left after line discounts

  await superadmin(page.request, baseURL!);
  await page.goto(`${baseURL}/superadmin/invoices/${id}`);
  await expect(page.getByTestId("invoice-subtotal")).toHaveText("Rp 1.400.000");
  await expect(page.getByTestId("invoice-discount")).toHaveText("− Rp 140.000");
  await expect(page.getByTestId("invoice-savings")).toHaveText("You save Rp 290.000");
  await expect(page.getByText("Rp 1.260.000").first()).toBeVisible();
});

test("a line discount that comes to nothing isn't kept, and old invoices print without a Discount column", async ({ request, baseURL, page }) => {
  await superadmin(request, baseURL!);
  const res = await create(request, baseURL!, {
    items: [
      { description: "Training (free)", quantity: 1, unitPrice: 0, discount: { type: "PERCENT", value: 50 } },
      { description: "Setup fee", quantity: 1, unitPrice: 1_000_000 },
    ],
  });
  expect(res.status()).toBe(201);
  const { id } = await res.json();
  const row = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  expect((row.items as { discount?: unknown }[]).every((i) => i.discount === undefined)).toBeTruthy();
  expect(Number(row.total)).toBe(1_000_000);

  await superadmin(page.request, baseURL!);
  await page.goto(`${baseURL}/superadmin/invoices/${id}`);
  await expect(page.getByTestId("line-discount")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Discount" })).toHaveCount(0);
  await expect(page.getByText("Total", { exact: true })).toBeVisible();
});

test("bad line discounts are refused", async ({ request, baseURL }) => {
  await superadmin(request, baseURL!);
  const withDiscount = (discount: object) => ({ items: [{ description: "Setup fee", quantity: 2, unitPrice: 100_000, discount }] }); // line is Rp 200.000
  const bad: [object, string][] = [
    [{ type: "PERCENT", value: 0 }, "greater than 0"],
    [{ type: "PERCENT", value: 101 }, "more than 100%"],
    [{ type: "AMOUNT", value: 200_001 }, "more than that item"],
    [{ type: "AMOUNT", value: 1000.5 }, "whole rupiah"],
    [{ type: "AMOUNT", value: -1 }, "greater than 0"],
    [{ type: "NOPE", value: 5 }, ""],
  ];
  for (const [discount, message] of bad) {
    const res = await create(request, baseURL!, withDiscount(discount));
    expect(res.status(), JSON.stringify(discount)).toBe(400);
    if (message) expect((await res.json()).error).toContain(message);
  }
  expect((await create(request, baseURL!, withDiscount({ type: "AMOUNT", value: 200_000 }))).status()).toBe(201); // the whole line is fine
  expect((await create(request, baseURL!, withDiscount({ type: "PERCENT", value: 100 }))).status()).toBe(201);
});

test("the form: a discount on each item, with the amounts updating live, then saved", async ({ page, baseURL }) => {
  await superadmin(page.request, baseURL!);
  await page.goto(`${baseURL}/superadmin/invoices/new`);
  await page.getByPlaceholder("Type any gym name").fill("Form Gym");
  await page.getByPlaceholder("Name of the person you are billing").fill("Form Owner");

  // First item: 2 × Rp 1.000.000, with 15% off.
  await page.getByLabel("Description").first().fill("Setup fee");
  await page.getByLabel("Unit price").first().fill("1000000");
  await page.getByLabel("Quantity").first().fill("2");
  await expect(page.getByTestId("invoice-preview")).toHaveCount(0); // no discounts yet
  await page.getByLabel("Item discount type").first().selectOption("PERCENT");
  await page.getByLabel("Item discount value").first().fill("15");
  await expect(page.getByTestId("line-amount").first()).toContainText("Rp 1.700.000");
  await expect(page.getByTestId("line-amount").first()).toContainText("−15%");

  // Second item has no discount, so only the first one changes.
  await page.getByRole("button", { name: "+ Add item" }).click();
  await page.getByLabel("Description").nth(1).fill("Training");
  await page.getByLabel("Unit price").nth(1).fill("250000");
  await expect(page.getByTestId("line-amount").nth(1)).toContainText("Rp 250.000");
  await expect(page.getByTestId("line-amount").nth(1)).not.toContainText("−");

  let preview = page.getByTestId("invoice-preview");
  await expect(preview).toContainText("Rp 2.250.000"); // items before discounts
  await expect(preview).toContainText("− Rp 300.000");
  await expect(preview).toContainText("Rp 1.950.000"); // total

  // A fixed amount on the second item; one bigger than the item's price is flagged.
  await page.getByLabel("Item discount type").nth(1).selectOption("AMOUNT");
  await page.getByLabel("Item discount value").nth(1).fill("900000");
  await expect(page.getByText("can't be more than the item's price")).toBeVisible();
  await page.getByLabel("Item discount value").nth(1).fill("50000");
  await expect(page.getByText("can't be more than the item's price")).toHaveCount(0);
  preview = page.getByTestId("invoice-preview");
  await expect(preview).toContainText("− Rp 350.000");
  await expect(preview).toContainText("Rp 1.900.000");

  await page.getByRole("button", { name: "Create invoice" }).click();
  await page.waitForURL(/\/superadmin\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("line-discount")).toHaveCount(2);
  await expect(page.getByTestId("invoice-savings")).toHaveText("You save Rp 350.000");
  await expect(page.getByText("Rp 1.900.000").first()).toBeVisible();
});
