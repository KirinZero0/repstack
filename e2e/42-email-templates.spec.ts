import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { renderEmail, resolveTemplate, templateError, textToHtml, htmlEmail } from "../src/lib/emailTemplates";
import { sendEmail } from "../src/lib/email";
import { MessageType } from "@prisma/client";
import { MESSAGE_TYPES, EMAIL_MESSAGE_TYPES, DEFAULT_EMAIL_TEMPLATES, SYSTEM_EMAIL_TYPES, DEFAULT_SYSTEM_EMAIL_TEMPLATES, SYSTEM_EMAIL_DESIGN } from "../src/config/email";
import { notifyOwner } from "../src/lib/notify";

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

const row = (gymId: string | null, type: string, subject: string, body: string) => ({ gymId, type, subject, body });

test("a template resolves gym type, gym default, platform type, platform default, then the built-in wording", () => {
  const rows = [
    row("g1", "payment_receipt", "G1 receipt, {{memberName}}", "G1 {{message}}"),
    row("g1", "default", "Hello from {{gymName}}", "Hi {{memberName}}\n{{message}}\nSee you at {{gymAddress}}"),
    row("g2", "payment_receipt", "G2 receipt", "G2 {{message}}"),
    row(null, "payment_receipt", "Platform receipt", "Platform {{message}}"),
    row(null, "class_reminder", "Platform reminder", "Platform {{message}}"),
    row(null, "default", "Platform default", "Platform default {{message}}"),
  ];
  expect(resolveTemplate(rows, "g1", "payment_receipt").subject).toBe("G1 receipt, {{memberName}}");
  // Another gym's template is never used for this one.
  expect(resolveTemplate(rows, "g3", "payment_receipt").subject).toBe("Platform receipt");
  expect(resolveTemplate(rows, "g2", "payment_receipt").subject).toBe("G2 receipt");
  // g1 has no reminder of its own: its own default wins over the platform's reminder.
  expect(resolveTemplate(rows, "g1", "class_reminder").subject).toBe("Hello from {{gymName}}");
  // g3 has nothing: platform type, then platform default.
  expect(resolveTemplate(rows, "g3", "class_reminder").subject).toBe("Platform reminder");
  expect(resolveTemplate(rows, "g3", "member_welcome").subject).toBe("Platform default");
  // No rows at all: the wording built into the app.
  expect(resolveTemplate([], "g3", "payment_receipt").subject).toBe("{{gymName}}: Payment received");
  expect(resolveTemplate([], null, "something_new").subject).toBe("{{gymName}}");

  const out = renderEmail(rows, "g1", "class_reminder", vars);
  expect(out.subject).toBe("Hello from Iron Co");
  expect(out.text).toBe("Hi Sari\nPay here: https://x.test/p?a=1&b=2\nSee you at Jl. 1");
});

test("a value is never expanded as a placeholder, and a subject can't carry a line break", () => {
  const out = renderEmail([], null, "member_welcome", { ...vars, memberName: "{{message}}", gymName: "Evil\r\nBcc: x@y.z", message: "{{gymName}}" });
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

const tpl = (request: APIRequestContext, baseURL: string, slug: string, data: unknown) =>
  request.post(`${baseURL}/api/${slug}/email-templates`, { data });

test("the owner saves, edits and resets a gym's templates, stored against that gym", async ({ request, baseURL }) => {
  const f = await makeGym();
  const other = await makeGym();
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });

  expect((await tpl(request, baseURL!, f.slug, { type: "member_activation", subject: "Welcome to {{gymName}}", body: "Hello {{memberName}},\n{{message}}" })).ok()).toBeTruthy();
  expect((await tpl(request, baseURL!, f.slug, { type: "member_activation", subject: "Edited {{gymName}}", body: "{{message}}" })).ok()).toBeTruthy();
  let rows = await prisma.emailTemplate.findMany({ where: { gymId: f.gym.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].subject).toBe("Edited {{gymName}}");
  expect(await prisma.emailTemplate.count({ where: { gymId: other.gym.id } })).toBe(0);

  // Rejections leave what is saved untouched.
  for (const bad of [
    { type: "member_activation", subject: "x", body: "no message" },
    { type: "member_activation", subject: "{{bogus}}", body: "{{message}}" },
    { type: "not_a_type", subject: "x", body: "{{message}}" },
    // Guests have no email, so their WhatsApp-only messages have no email template.
    { type: "guest_ticket", subject: "x", body: "{{message}}" },
    { type: "member_activation", subject: "a\nb", body: "{{message}}" },
  ]) {
    expect((await tpl(request, baseURL!, f.slug, bad)).status()).toBe(400);
  }
  rows = await prisma.emailTemplate.findMany({ where: { gymId: f.gym.id } });
  expect(rows[0].subject).toBe("Edited {{gymName}}");

  // The reply-to address is a gym setting.
  expect((await settings(request, baseURL!, f.slug, { emailReplyTo: "hello@gym.test" })).ok()).toBeTruthy();
  expect((await settings(request, baseURL!, f.slug, { emailReplyTo: "not-an-email" })).status()).toBe(400);

  expect((await tpl(request, baseURL!, f.slug, { type: "member_activation", reset: true })).ok()).toBeTruthy();
  expect(await prisma.emailTemplate.count({ where: { gymId: f.gym.id } })).toBe(0);
});

test("one platform default per type, and the gym's own template wins over it when sending", async ({ request, baseURL }) => {
  const type = "class_cancelled";
  await prisma.emailTemplate.deleteMany({ where: { gymId: null, type } });
  await prisma.emailTemplate.create({ data: { gymId: null, type, subject: "Platform: {{gymName}}", body: "{{message}}" } });
  // A second platform row for the same type is refused by the database.
  await expect(prisma.emailTemplate.create({ data: { gymId: null, type, subject: "dup", body: "{{message}}" } })).rejects.toThrow();

  const f = await makeGym();
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });
  const rows = await prisma.emailTemplate.findMany({ where: { OR: [{ gymId: f.gym.id }, { gymId: null }] } });
  expect(resolveTemplate(rows, f.gym.id, type).subject).toBe("Platform: {{gymName}}");
  await tpl(request, baseURL!, f.slug, { type, subject: "Ours: {{gymName}}", body: "{{message}}" });
  const after = await prisma.emailTemplate.findMany({ where: { OR: [{ gymId: f.gym.id }, { gymId: null }] } });
  expect(resolveTemplate(after, f.gym.id, type).subject).toBe("Ours: {{gymName}}");
  await prisma.emailTemplate.deleteMany({ where: { gymId: null, type } });
});

test("a member email is logged as sent, and staff can't edit templates", async ({ request, baseURL }) => {
  const f = await makeGym();
  const staff = { email: `staff-${f.slug}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: f.gym.id, name: "Staff", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });
  await settings(request, baseURL!, f.slug, { notifyEmail: true });
  await tpl(request, baseURL!, f.slug, { type: "member_activation", subject: "Hi {{memberName}}", body: "{{message}}" });
  const plan = await prisma.membershipPlan.create({ data: { gymId: f.gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const res = await request.post(`${baseURL}/api/${f.slug}/members`, {
    data: { fullName: "Tpl Member", email: `${uniq("m")}@test.local`, phoneWhatsapp: `0819${Date.now().toString().slice(-7)}${seq++}`, planId: plan.id },
  });
  expect(res.status()).toBe(201);
  const logs = await prisma.notificationLog.findMany({ where: { gymId: f.gym.id, channel: "email" } });
  expect(logs.map((l) => `${l.type}:${l.status}`)).toContain("member_activation:SENT");

  const staffReq = await playwrightRequest.newContext({ baseURL });
  await staffReq.post(`${baseURL}/api/${f.slug}/login`, { data: staff });
  expect((await tpl(staffReq, baseURL!, f.slug, { type: "default", subject: "x", body: "{{message}}" })).status()).toBe(403);
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
    const r = await sendEmail({ to: "m@x.test", subject: "S", text: "T", html: "<p>T</p>", replyTo: "hi@gym.test" });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("https://api.eu.mailgun.net/v3/mg.liftmora.test/messages");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("api:key-123").toString("base64")}`);
    const form = calls[0].init.body as URLSearchParams;
    expect(form.get("from")).toBe("Liftmora <no-reply@mg.liftmora.test>");
    expect(form.get("to")).toBe("m@x.test");
    expect(form.get("html")).toBe("<p>T</p>");
    expect(form.get("h:Reply-To")).toBe("hi@gym.test");

    // A provider error comes back as a failure with its message, not a throw.
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "Forbidden" }), { status: 401 })) as typeof fetch;
    expect(await sendEmail({ to: "m@x.test", subject: "S", text: "T" })).toEqual({ ok: false, error: "Forbidden" });

    // Nothing configured: skipped, no call.
    delete process.env.MAILGUN_API_KEY;
    delete process.env.RESEND_API_KEY;
    expect((await sendEmail({ to: "m@x.test", subject: "S", text: "T" })).skipped).toBe(true);
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
  const saved = await prisma.emailTemplate.findFirstOrThrow({ where: { gymId: f.gym.id, type: "payment_receipt" } });
  expect(saved.subject).toBe("Thanks, {{memberName}}!");

  await page.getByRole("button", { name: "Back to default" }).click();
  await expect(page.getByLabel("Email subject")).toHaveValue("{{gymName}}: Payment received");
});

test("the message types in code are exactly the database enum, and every emailable one has default wording", async () => {
  expect([...MESSAGE_TYPES].sort()).toEqual(Object.values(MessageType).sort());
  expect(Object.keys(DEFAULT_EMAIL_TEMPLATES).sort()).toEqual(Object.keys(EMAIL_MESSAGE_TYPES).sort());
  expect(Object.keys(DEFAULT_SYSTEM_EMAIL_TEMPLATES).sort()).toEqual(Object.keys(SYSTEM_EMAIL_TYPES).sort());
  expect(Object.keys(SYSTEM_EMAIL_DESIGN).sort()).toEqual(Object.keys(SYSTEM_EMAIL_TYPES).sort());
  // Every message type is either a member email (or the default slot), a system email, or WhatsApp-only.
  const known = new Set<string>([...Object.keys(EMAIL_MESSAGE_TYPES), ...Object.keys(SYSTEM_EMAIL_TYPES), "guest_ticket", "guest_rejected"]);
  expect([...MESSAGE_TYPES].filter((t) => !known.has(t))).toEqual([]);
  // The database itself refuses a type that isn't in the enum.
  await expect(prisma.$executeRawUnsafe(`INSERT INTO "EmailTemplate" (id, type, subject, body, "updatedAt") VALUES ('x', 'bogus', 's', 'b', now())`)).rejects.toThrow();
});

test("Mailjet gets a v3.1 JSON post with basic auth, and a per-message error counts as a failure", async () => {
  const keep = { ...process.env };
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  let reply: () => Response = () => new Response(JSON.stringify({ Messages: [{ Status: "success" }] }), { status: 200 });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return reply();
  }) as typeof fetch;
  try {
    Object.assign(process.env, { EMAIL_MOCK: "", MAILJET_API_KEY: "pub", MAILJET_SECRET_KEY: "sec", EMAIL_FROM: "noreply@liftmora.test" });
    for (const k of ["MAILGUN_API_KEY", "MAILGUN_DOMAIN", "RESEND_API_KEY", "EMAIL_PROVIDER"]) delete process.env[k];
    const r = await sendEmail({ to: "m@x.test", subject: "S", text: "T", html: "<p>T</p>", replyTo: "hi@gym.test" });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("https://api.mailjet.com/v3.1/send");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("pub:sec").toString("base64")}`);
    const msg = JSON.parse(calls[0].init.body as string).Messages[0];
    expect(msg.From).toEqual({ Email: "noreply@liftmora.test", Name: "Liftmora" });
    expect(msg.To).toEqual([{ Email: "m@x.test" }]);
    expect(msg.TextPart).toBe("T");
    expect(msg.HTMLPart).toBe("<p>T</p>");
    expect(msg.ReplyTo).toEqual({ Email: "hi@gym.test" });

    reply = () => new Response(JSON.stringify({ Messages: [{ Status: "error", Errors: [{ ErrorMessage: "Sender not verified" }] }] }), { status: 200 });
    expect(await sendEmail({ to: "m@x.test", subject: "S", text: "T" })).toEqual({ ok: false, error: "Sender not verified" });

    // Without a verified sender address Mailjet isn't "configured", so nothing is sent.
    delete process.env.EMAIL_FROM;
    const before = calls.length;
    expect((await sendEmail({ to: "m@x.test", subject: "S", text: "T" })).skipped).toBe(true);
    expect(calls.length).toBe(before);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ["EMAIL_MOCK", "MAILJET_API_KEY", "MAILJET_SECRET_KEY", "EMAIL_FROM", "MAILGUN_API_KEY", "MAILGUN_DOMAIN", "RESEND_API_KEY", "EMAIL_PROVIDER"]) {
      if (keep[k] === undefined) delete process.env[k];
      else process.env[k] = keep[k];
    }
  }
});

test("the HTML email has the gym header, a heading, a button only where there is a link, and escapes everything", () => {
  const link = renderEmail([], null, "password_reset", { ...vars, gymName: "Iron <Co> & Sons", message: "Set it here: https://x.test/reset/abc (valid 1 hour)" });
  expect(link.html).toContain("<!DOCTYPE html>");
  expect(link.html).toContain("Iron &lt;Co&gt; &amp; Sons");
  expect(link.html).not.toContain("<Co>");
  expect(link.html).toContain("Reset your password");
  // Liftmora's mark and name head every email, loaded from the app's own address.
  expect(link.html).toMatch(/<img src="https?:\/\/[^"]+\/icons\/email-logo\.png" width="26"/);
  // Each kind of message has its own badge.
  expect(link.html).toMatch(/<img src="https?:\/\/[^"]+\/email\/password_reset\.png" width="56"/);
  expect(link.html).toContain(">Liftmora</td>");
  expect(link.html).toContain("Choose a new password &rarr;");
  // The button goes to the first link, labelled for this kind of message.
  expect(link.html).toMatch(/<a href="https:\/\/x\.test\/reset\/abc"[^>]*>Choose a new password &rarr;<\/a>/);

  // A receipt has no link, so no button; a type with a button label but no link in the text gets none either.
  expect(renderEmail([], null, "payment_receipt", vars).html).not.toContain("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:8px");
  expect(htmlEmail({ text: "No link at all.", type: "member_activation", gymName: "G", gymAddress: "" })).not.toContain("Set your password");
  // Messages we don't know are still wrapped, under the generic heading.
  expect(htmlEmail({ text: "Hello", type: "something_new", gymName: "G", gymAddress: "" })).toContain("A message from your gym");
  // A hostile name or message can't inject markup.
  expect(htmlEmail({ text: "<script>alert(1)</script>", type: "default", gymName: "<img src=x>", gymAddress: "" })).not.toMatch(/<script|<img src=x/);
});

test("system emails use the platform's wording, never a gym's, and a platform row overrides the built-in", () => {
  const rows = [
    { gymId: "g1", type: "gym_welcome", subject: "Gym wrote this", body: "{{message}}" },
    { gymId: "g1", type: "default", subject: "Gym default", body: "{{message}}" },
  ];
  expect(resolveTemplate(rows, "g1", "gym_welcome").subject).toBe("Welcome to Liftmora, {{gymName}} is ready");
  expect(resolveTemplate([...rows, { gymId: null, type: "gym_welcome", subject: "Platform {{gymName}}", body: "{{message}}" }], "g1", "gym_welcome").subject).toBe("Platform {{gymName}}");

  const out = renderEmail([], null, "subscription_due", { ...vars, message: "Pay here: https://x.test/pay/1" });
  expect(out.subject).toBe("Your Liftmora subscription for Iron Co is due");
  expect(out.html).toContain("Your subscription is due");
  expect(out.html).toContain("Pay your invoice &rarr;");
  expect(out.html).toContain("/email/subscription_due.png");
  expect(out.html).toContain("Sent by Liftmora about Iron Co.");
  // A billing receipt has no button.
  expect(renderEmail([], null, "subscription_paid", vars).html).not.toContain("&rarr;");
});

test("notifyOwner emails and messages the owner, logs both against the gym, and skips what it can't reach", async () => {
  const f = await makeGym();
  const marker = new Date();
  // An automatic send is email only; a person clicking a button can also use WhatsApp.
  await notifyOwner({ gymId: f.gym.id, gymName: f.gym.name, to: { name: "Owner", email: f.owner.email, phone: "081200009999" }, type: "subscription_paid", message: "Thanks." });
  await notifyOwner({ gymId: f.gym.id, gymName: f.gym.name, to: { name: "Owner", email: f.owner.email, phone: "081200009999" }, type: "subscription_due", trigger: "manual", message: "Pay here: https://x.test/pay" });
  await notifyOwner({ gymId: f.gym.id, gymName: f.gym.name, to: { name: "Owner", email: `bad+bounce@x.test` }, type: "gym_suspended", message: "Suspended." });
  await notifyOwner({ gymId: f.gym.id, gymName: f.gym.name, to: { name: "Owner" }, type: "staff_invite", message: "No way to reach them." });
  const logs = (await prisma.notificationLog.findMany({ where: { gymId: f.gym.id, sentAt: { gte: marker } } })).map((l) => `${l.type}:${l.channel}:${l.status}`).sort();
  expect(logs).toContain("subscription_paid:email:SENT");
  expect(logs.filter((l) => l.startsWith("subscription_paid:whatsapp"))).toEqual([]);
  expect(logs).toContain("subscription_due:email:SENT");
  expect(logs.some((l) => l.startsWith("subscription_due:whatsapp:"))).toBe(true);
  expect(logs).toContain("gym_suspended:email:FAILED");
  expect(logs.filter((l) => l.startsWith("staff_invite"))).toEqual([]);
});

test("setting up a gym emails its owner a welcome from Liftmora", async ({ request, baseURL }) => {
  await request.post(`${baseURL}/api/superadmin/login`, { data: { email: "superadmin@test.local", password: "superadmin-pass-123" } });
  const plan = await prisma.saasPlan.create({ data: { name: uniq("Sys"), price: 1, billingInterval: "monthly", maxMembers: 100, maxStaff: 5, maxWhatsappPerMonth: 500 } });
  const slug = uniq("sys");
  const res = await request.post(`${baseURL}/api/superadmin/gyms`, {
    data: { gymName: `Sys ${slug}`, slug, saasPlanId: plan.id, ownerName: "New Owner", ownerEmail: `${slug}@owner.test`, ownerTempPassword: "temp-pass-1234" },
  });
  expect(res.status()).toBe(201);
  const gym = await prisma.gym.findUniqueOrThrow({ where: { slug } });
  const logs = await prisma.notificationLog.findMany({ where: { gymId: gym.id } });
  expect(logs.map((l) => `${l.type}:${l.channel}:${l.status}`)).toContain("gym_welcome:email:SENT");
});
