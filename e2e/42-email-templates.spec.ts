import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { renderEmail, resolveTemplate, templateError, textToHtml } from "../src/lib/emailTemplates";
import { sendEmail } from "../src/lib/email";

let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

async function makeGym() {
  const plan = await prisma.saasPlan.create({
    data: { name: uniq("Tpl"), price: 1, billingInterval: "monthly", maxMembers: 100, maxStaff: 5, maxWhatsappPerMonth: 500 },
  });
  const tag = uniq("tpl");
  const gym = await prisma.gym.create({ data: { name: `Tpl ${tag}`, slug: tag, saasPlanId: plan.id, subscriptionStatus: "ACTIVE" } });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  return { gym, owner, slug: tag };
}

const settings = (request: APIRequestContext, baseURL: string, slug: string, data: unknown) =>
  request.post(`${baseURL}/api/${slug}/settings`, { data });

const vars = { gymName: "Iron Co", memberName: "Sari", gymAddress: "Jl. 1", message: "Pay here: https://x.test/p?a=1&b=2" };

test("templates resolve gym type, then gym default, then platform default, and fill placeholders once", () => {
  const s = {
    emailTemplates: {
      default: { subject: "Hello from {{gymName}}", body: "Hi {{memberName}}\n{{message}}\nSee you at {{gymAddress}}" },
      payment_receipt: { subject: "Receipt, {{memberName}}" },
    },
  };
  // Own type overrides the subject only; the body falls through to the gym's default.
  const own = resolveTemplate(s, "payment_receipt");
  expect(own.subject).toBe("Receipt, {{memberName}}");
  expect(own.body).toContain("See you at");
  // A type with nothing of its own uses the gym default.
  expect(resolveTemplate(s, "class_reminder").subject).toBe("Hello from {{gymName}}");
  // A gym with no templates gets the platform wording.
  expect(resolveTemplate({}, "payment_receipt").subject).toBe("{{gymName}}: Payment received");
  expect(resolveTemplate(null, "something_new").subject).toBe("{{gymName}}");

  const out = renderEmail(s, "class_reminder", vars);
  expect(out.subject).toBe("Hello from Iron Co");
  expect(out.text).toBe("Hi Sari\nPay here: https://x.test/p?a=1&b=2\nSee you at Jl. 1");
});

test("a value is never expanded as a placeholder, and a subject can't carry a line break", () => {
  const out = renderEmail({}, "member_welcome", { ...vars, memberName: "{{message}}", gymName: "Evil\r\nBcc: x@y.z", message: "{{gymName}}" });
  expect(out.text).toContain("{{gymName}}");
  expect(out.subject).not.toMatch(/[\r\n]/);
  expect(textToHtml("<b>hi</b> https://a.test/?x=1&y=2")).toContain("&lt;b&gt;hi&lt;/b&gt;");
  expect(textToHtml("https://a.test/?x=1&y=2")).toContain('<a href="https://a.test/?x=1&amp;y=2">');
});

test("templateError catches the mistakes an owner can make", () => {
  expect(templateError({ subject: "Hi", body: "{{message}}" })).toBeNull();
  expect(templateError({ subject: "", body: "{{message}}" })).toMatch(/subject and a body/);
  expect(templateError({ subject: "Hi", body: "No link here" })).toMatch(/\{\{message\}\}/);
  expect(templateError({ subject: "Hi {{nope}}", body: "{{message}}" })).toMatch(/\{\{nope\}\}/);
  expect(templateError({ subject: "a\nb", body: "{{message}}" })).toMatch(/single line/);
});

test("the owner saves, edits and resets a gym's templates over the API", async ({ request, baseURL }) => {
  const f = await makeGym();
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });

  const ok = await settings(request, baseURL!, f.slug, {
    emailTemplates: { member_activation: { subject: "Welcome to {{gymName}}", body: "Hello {{memberName}},\n{{message}}" } },
    emailReplyTo: "hello@gym.test",
  });
  expect(ok.ok()).toBeTruthy();
  let saved = (await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).settings as Record<string, any>;
  expect(saved.emailTemplates.member_activation.subject).toBe("Welcome to {{gymName}}");
  expect(saved.emailReplyTo).toBe("hello@gym.test");

  // Rejections leave what is saved untouched.
  for (const bad of [
    { emailTemplates: { member_activation: { subject: "x", body: "no message" } } },
    { emailTemplates: { member_activation: { subject: "{{bogus}}", body: "{{message}}" } } },
    { emailTemplates: { not_a_type: { subject: "x", body: "{{message}}" } } },
    { emailReplyTo: "not-an-email" },
  ]) {
    expect((await settings(request, baseURL!, f.slug, bad)).status()).toBe(400);
  }
  saved = (await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).settings as Record<string, any>;
  expect(saved.emailTemplates.member_activation.body).toBe("Hello {{memberName}},\n{{message}}");

  // null puts one back to the default; clearing the last one removes the key.
  expect((await settings(request, baseURL!, f.slug, { emailTemplates: { member_activation: null }, emailReplyTo: "" })).ok()).toBeTruthy();
  saved = (await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).settings as Record<string, any>;
  expect(saved.emailTemplates).toBeUndefined();
  expect(saved.emailReplyTo).toBeUndefined();
});

test("a member email is logged as sent using the gym's template, and staff can't edit templates", async ({ request, baseURL }) => {
  const f = await makeGym();
  const staff = { email: `staff-${f.slug}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: f.gym.id, name: "Staff", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });
  await settings(request, baseURL!, f.slug, { notifyEmail: true, emailTemplates: { member_activation: { subject: "Hi {{memberName}}", body: "{{message}}" } } });
  const plan = await prisma.membershipPlan.create({ data: { gymId: f.gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const res = await request.post(`${baseURL}/api/${f.slug}/members`, {
    data: { fullName: "Tpl Member", email: `${uniq("m")}@test.local`, phoneWhatsapp: `0819${Date.now().toString().slice(-7)}${seq++}`, planId: plan.id },
  });
  expect(res.status()).toBe(201);
  const logs = await prisma.notificationLog.findMany({ where: { gymId: f.gym.id, channel: "email" } });
  expect(logs.map((l) => `${l.type}:${l.status}`)).toContain("member_activation:SENT");

  const staffReq = await playwrightRequest.newContext({ baseURL });
  await staffReq.post(`${baseURL}/api/${f.slug}/login`, { data: staff });
  expect((await settings(staffReq, baseURL!, f.slug, { emailTemplates: { default: { subject: "x", body: "{{message}}" } } })).status()).toBe(403);
});

test("Mailgun gets a form post to the right region and domain, with HTML and reply-to", async () => {
  const keep = { ...process.env };
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    Object.assign(process.env, { EMAIL_MOCK: "", MAILGUN_API_KEY: "key-123", MAILGUN_DOMAIN: "mg.liftmora.test", MAILGUN_REGION: "eu" });
    delete process.env.EMAIL_PROVIDER;
    const r = await sendEmail({ to: "m@x.test", subject: "S", text: "T", html: "<p>T</p>", fromName: 'Iron "Co"', replyTo: "hi@gym.test" });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("https://api.eu.mailgun.net/v3/mg.liftmora.test/messages");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("api:key-123").toString("base64")}`);
    const form = calls[0].init.body as URLSearchParams;
    expect(form.get("from")).toBe("Iron Co <no-reply@mg.liftmora.test>");
    expect(form.get("to")).toBe("m@x.test");
    expect(form.get("html")).toBe("<p>T</p>");
    expect(form.get("h:Reply-To")).toBe("hi@gym.test");

    // A provider error comes back as a failure with its message, not a throw.
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "Forbidden" }), { status: 401 })) as typeof fetch;
    expect(await sendEmail({ to: "m@x.test", subject: "S", text: "T", fromName: "G" })).toEqual({ ok: false, error: "Forbidden" });

    // Nothing configured: skipped, no call.
    delete process.env.MAILGUN_API_KEY;
    delete process.env.RESEND_API_KEY;
    expect((await sendEmail({ to: "m@x.test", subject: "S", text: "T", fromName: "G" })).skipped).toBe(true);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ["EMAIL_MOCK", "MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_REGION", "EMAIL_PROVIDER", "RESEND_API_KEY"]) {
      if (keep[k] === undefined) delete process.env[k];
      else process.env[k] = keep[k];
    }
  }
});

test("the owner edits a template on the settings page and sees the preview", async ({ page, baseURL }) => {
  const f = await makeGym();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.42.0.${(seq % 200) + 1}` });
  await page.goto(`${baseURL}/${f.slug}/login`);
  await page.getByLabel("Email").fill(f.owner.email);
  await page.getByLabel("Password").fill(f.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);
  await page.goto(`${baseURL}/${f.slug}/settings`);

  await page.getByLabel("Email type").selectOption("payment_receipt");
  await page.getByLabel("Email subject").fill("Thanks, {{memberName}}!");
  await expect(page.getByText("Thanks, Sari Wijaya!")).toBeVisible();
  await page.getByRole("button", { name: "Save email" }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  const saved = (await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).settings as Record<string, any>;
  expect(saved.emailTemplates.payment_receipt.subject).toBe("Thanks, {{memberName}}!");

  await page.getByRole("button", { name: "Back to default" }).click();
  await expect(page.getByLabel("Email subject")).toHaveValue("{{gymName}}: Payment received");
});
