import { PrismaClient, Prisma, MemberStatus, PaymentStatus, CheckInResult } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { encrypt, hmacLookup } from "../src/lib/crypto";
import { buildQrToken, buildStationToken } from "../src/lib/qr";
import { generateMagicToken } from "../src/lib/magicLink";
import { PLAN_SEEDS } from "./plans";

/**
 * Client-presentation seed. Builds "Gym Garuda Perkasa" (slug: garuda-perkasa) with data for every
 * feature, plus a handful of other tenants so the superadmin screens look like a real platform.
 *
 *   npm run db:seed:showcase
 *
 * Safe to re-run: it deletes and recreates only the showcase gyms (matched by slug), never touches
 * anything else. Needs the usual env (DATABASE_URL, ENCRYPTION_KEY, LOOKUP_HMAC_KEY, QR_SERVER_SECRET).
 * Run it with WHATSAPP_MOCK=1 and PAYMENTS_MOCK=1 on the app so "send" and "pay" buttons work offline.
 */

const prisma = new PrismaClient();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = new Date();
const ago = (ms: number) => new Date(now.getTime() - ms);
const ahead = (ms: number) => new Date(now.getTime() + ms);
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];

const MAIN_SLUG = "garuda-perkasa";
const STAFF_PASSWORD = "garuda123";
const MEMBER_PASSWORD = "member123";
const SUPERADMIN_EMAIL = "admin@ironledger.dev";
const SUPERADMIN_PASSWORD = "changeme123";
const OTHER_SLUGS = ["fit-nusantara", "iron-borneo", "bali-strong", "arena-otot", "kampung-sehat", "warung-fitness"];
const SHOWCASE_SLUGS = [MAIN_SLUG, ...OTHER_SLUGS];

/** A moment on the gym's wall clock (Asia/Jakarta, UTC+7, no DST), `dayOffset` days from today. */
function jakarta(dayOffset: number, hour: number, minute = 0): Date {
  const j = new Date(now.getTime() + 7 * HOUR);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + dayOffset, hour - 7, minute));
}

async function wipe() {
  const gyms = await prisma.gym.findMany({ where: { slug: { in: SHOWCASE_SLUGS } }, select: { id: true } });
  const gymIds = gyms.map((g) => g.id);
  if (gymIds.length) {
    const where = { gymId: { in: gymIds } };
    await prisma.classPayment.deleteMany({ where });
    await prisma.classRegistration.deleteMany({ where });
    await prisma.classSession.deleteMany({ where });
    await prisma.gymClass.deleteMany({ where });
    await prisma.notificationLog.deleteMany({ where });
    await prisma.magicLink.deleteMany({ where: { member: where } });
    await prisma.checkIn.deleteMany({ where });
    await prisma.payment.deleteMany({ where });
    await prisma.memberSignup.deleteMany({ where });
    await prisma.member.deleteMany({ where });
    await prisma.auditLog.deleteMany({ where });
    await prisma.whatsappSenderConfig.deleteMany({ where });
    await prisma.platformPayment.deleteMany({ where });
    await prisma.staffUser.deleteMany({ where });
    await prisma.membershipPlan.deleteMany({ where });
    await prisma.gym.deleteMany({ where: { id: { in: gymIds } } });
  }
  await prisma.gymSignup.deleteMany({ where: { slug: { in: ["sehat-bugar-medan", "bumi-fit-makassar"] } } });
}

async function ensureSaasPlans() {
  for (const p of PLAN_SEEDS) {
    if (!(await prisma.saasPlan.findFirst({ where: { name: p.name } }))) {
      await prisma.saasPlan.create({ data: { ...p, currency: "IDR" } });
    }
  }
  const byName = async (name: string) => prisma.saasPlan.findFirstOrThrow({ where: { name } });
  return { byName };
}

async function ensureSuperadmin() {
  return (
    (await prisma.superadmin.findUnique({ where: { email: SUPERADMIN_EMAIL } })) ??
    (await prisma.superadmin.create({
      data: { name: "Repstack Admin", email: SUPERADMIN_EMAIL, passwordHash: await bcrypt.hash(SUPERADMIN_PASSWORD, 10) },
    }))
  );
}

interface MemberSpec {
  name: string;
  plan: number; // index into plans
  status: MemberStatus;
  expiryDays: number | null; // relative to now; negative = already expired
  freq: number; // 0..1 chance of visiting on a given day over the last 60 days
  streak?: number; // consecutive days up to today/yesterday
  activated?: boolean; // has a password
  phone: string;
}

const MEMBERS: MemberSpec[] = [
  { name: "Budi Santoso", plan: 1, status: "ACTIVE", expiryDays: 18, freq: 0.7, streak: 12, phone: "081211110001" },
  { name: "Sari Dewi Lestari", plan: 3, status: "ACTIVE", expiryDays: 240, freq: 0.65, streak: 9, phone: "081211110002" },
  { name: "Andi Wijaya", plan: 1, status: "ACTIVE", expiryDays: 11, freq: 0.55, streak: 6, phone: "081211110003" },
  { name: "Rina Putri Anggraini", plan: 2, status: "ACTIVE", expiryDays: 54, freq: 0.5, streak: 4, phone: "081211110004" },
  { name: "Dimas Pratama", plan: 1, status: "ACTIVE", expiryDays: 25, freq: 0.5, streak: 3, phone: "081211110005" },
  { name: "Lala Kusuma Wardani", plan: 4, status: "ACTIVE", expiryDays: 9, freq: 0.45, streak: 2, phone: "081211110006" },
  { name: "Eko Nugroho", plan: 1, status: "ACTIVE", expiryDays: 14, freq: 0.4, phone: "081211110007" },
  { name: "Maya Sari Hartono", plan: 3, status: "ACTIVE", expiryDays: 300, freq: 0.4, phone: "081211110008" },
  { name: "Agus Setiawan", plan: 1, status: "ACTIVE", expiryDays: 20, freq: 0.35, phone: "081211110009" },
  { name: "Wulan Handayani", plan: 4, status: "ACTIVE", expiryDays: 16, freq: 0.35, phone: "081211110010" },
  { name: "Rizky Ramadhan", plan: 1, status: "ACTIVE", expiryDays: 7, freq: 0.3, phone: "081211110011" },
  { name: "Putri Ayu Maharani", plan: 2, status: "ACTIVE", expiryDays: 40, freq: 0.3, phone: "081211110012" },
  { name: "Hendra Gunawan", plan: 1, status: "ACTIVE", expiryDays: 22, freq: 0.25, phone: "081211110013" },
  { name: "Siti Nurhaliza", plan: 1, status: "ACTIVE", expiryDays: 27, freq: 0.25, phone: "081211110014" },
  { name: "Bayu Prakoso", plan: 0, status: "ACTIVE", expiryDays: 0.5, freq: 0.2, phone: "081211110015" },
  // Expiring within 3 days — shows on the dashboard "expiring soon" list and the reminder cron
  { name: "Fajar Nugraha", plan: 1, status: "ACTIVE", expiryDays: 2, freq: 0.5, phone: "081211110016" },
  { name: "Dewi Anggraeni", plan: 1, status: "ACTIVE", expiryDays: 3, freq: 0.45, phone: "081211110017" },
  { name: "Yoga Aditya", plan: 4, status: "ACTIVE", expiryDays: 1, freq: 0.4, phone: "081211110018" },
  // Lapsed
  { name: "Tono Suharto", plan: 1, status: "EXPIRED", expiryDays: -6, freq: 0.15, phone: "081211110019" },
  { name: "Indah Permatasari", plan: 1, status: "EXPIRED", expiryDays: -20, freq: 0.1, phone: "081211110020" },
  { name: "Joko Widodo Kusumo", plan: 2, status: "EXPIRED", expiryDays: -45, freq: 0.05, phone: "081211110021" },
  // Frozen (cuti)
  { name: "Ratna Sari Dewi", plan: 3, status: "FROZEN", expiryDays: 120, freq: 0.1, phone: "081211110022" },
  { name: "Galih Purnomo", plan: 1, status: "FROZEN", expiryDays: 21, freq: 0.1, phone: "081211110023" },
  // Never paid yet — still pending, invoice open
  { name: "Nadia Safitri", plan: 1, status: "PENDING_PAYMENT", expiryDays: null, freq: 0, activated: false, phone: "081211110024" },
  { name: "Reza Mahendra", plan: 2, status: "PENDING_PAYMENT", expiryDays: null, freq: 0, activated: false, phone: "081211110025" },
  // Paid but hasn't opened the activation link yet
  { name: "Citra Kirana", plan: 1, status: "ACTIVE", expiryDays: 29, freq: 0, activated: false, phone: "081211110026" },
  { name: "Farhan Alamsyah", plan: 1, status: "ACTIVE", expiryDays: 28, freq: 0, activated: false, phone: "081211110027" },
  // Cancelled
  { name: "Gita Gutawa", plan: 1, status: "CANCELLED", expiryDays: -60, freq: 0, phone: "081211110028" },
  { name: "Hasan Basri", plan: 1, status: "CANCELLED", expiryDays: -90, freq: 0, phone: "081211110029" },
];

const MEMBERSHIP_PLANS = [
  { name: "Harian (Day Pass)", durationDays: 1, price: 50_000 },
  { name: "Bulanan", durationDays: 30, price: 350_000 },
  { name: "Triwulan (3 Bulan)", durationDays: 90, price: 900_000 },
  { name: "Tahunan", durationDays: 365, price: 3_000_000 },
  { name: "Pelajar & Mahasiswa", durationDays: 30, price: 250_000 },
  { name: "Promo Lebaran (Berakhir)", durationDays: 30, price: 199_000, isActive: false },
];

function invoiceFor(id: string) {
  return { externalInvoiceId: `mock_${id}`, invoiceUrl: `/my?mock-invoice=${id}` };
}

async function seedMainGym(saas: Awaited<ReturnType<typeof ensureSaasPlans>>, superadminId: string) {
  const growth = await saas.byName("Growth Monthly");

  const gym = await prisma.gym.create({
    data: {
      name: "Gym Garuda Perkasa",
      slug: MAIN_SLUG,
      saasPlanId: growth.id,
      subscriptionStatus: "ACTIVE",
      nextBillingDate: ahead(12 * DAY),
      timezone: "Asia/Jakarta",
      termsAcceptedAt: ago(200 * DAY),
      description:
        "Pusat kebugaran terlengkap di Jakarta Selatan. Peralatan lengkap, kelas grup harian, dan pelatih bersertifikat — dari pemula sampai atlet. Buka setiap hari pukul 05.00–23.00 WIB.",
      address: "Jl. Jenderal Sudirman Kav. 52, Senayan, Jakarta Selatan 12190",
      photoUrls: [
        "https://picsum.photos/seed/garuda-gym-1/1200/800",
        "https://picsum.photos/seed/garuda-gym-2/1200/800",
        "https://picsum.photos/seed/garuda-gym-3/1200/800",
        "https://picsum.photos/seed/garuda-gym-4/1200/800",
      ],
      bankName: "BCA",
      bankAccountNumber: "5271-889-120",
      bankAccountHolder: "PT Garuda Perkasa Fitindo",
      settings: { acceptSignups: true, paymentsEnabled: true, leaderboardEnabled: true, occupancyWindowHours: 3 },
    },
  });

  // ── Staff ──
  const passwordHash = await bcrypt.hash(STAFF_PASSWORD, 10);
  const owner = await prisma.staffUser.create({
    data: { gymId: gym.id, name: "Pak Hendro Wibowo", email: "owner@garudaperkasa.id", phone: "081300000001", passwordHash, role: "OWNER" },
  });
  const staff1 = await prisma.staffUser.create({
    data: { gymId: gym.id, name: "Mbak Ayu Lestari", email: "ayu@garudaperkasa.id", phone: "081300000002", passwordHash, role: "STAFF" },
  });
  const staff2 = await prisma.staffUser.create({
    data: { gymId: gym.id, name: "Mas Rudi Hartono", email: "rudi@garudaperkasa.id", phone: "081300000003", passwordHash, role: "STAFF" },
  });
  await prisma.staffUser.create({
    data: { gymId: gym.id, name: "Doni Kurniawan (resign)", email: "doni@garudaperkasa.id", passwordHash, role: "STAFF", isActive: false },
  });

  // ── WhatsApp sender ──
  await prisma.whatsappSenderConfig.create({
    data: { gymId: gym.id, gatewayProvider: "fonnte", senderNumber: "6281300000001", apiKeyEncrypted: encrypt("demo-fonnte-key-garuda"), isActive: true },
  });

  // ── Membership plans ──
  const plans = [];
  for (const p of MEMBERSHIP_PLANS) plans.push(await prisma.membershipPlan.create({ data: { gymId: gym.id, currency: "IDR", ...p } }));

  // ── Members ──
  const memberHash = await bcrypt.hash(MEMBER_PASSWORD, 10);
  const members: { id: string; spec: MemberSpec; email: string; qrSecret: string }[] = [];
  for (let i = 0; i < MEMBERS.length; i++) {
    const spec = MEMBERS[i];
    const email = `${spec.name.toLowerCase().replace(/[^a-z ]/g, "").split(" ").slice(0, 2).join(".")}@gmail.com`;
    const activated = spec.activated !== false;
    const created = await prisma.member.create({
      data: {
        gymId: gym.id,
        planId: plans[spec.plan].id,
        fullName: spec.name,
        email,
        phoneWhatsapp: encrypt(spec.phone),
        phoneWhatsappLookup: hmacLookup(spec.phone),
        passwordHash: activated ? memberHash : null,
        status: spec.status,
        membershipExpiry: spec.expiryDays === null ? null : ahead(spec.expiryDays * DAY),
        frozenAt: spec.status === "FROZEN" ? ago(9 * DAY) : null,
        termsAcceptedAt: activated ? ago((60 - i) * DAY) : null,
        createdAt: ago((150 - i * 4) * DAY),
      },
    });
    members.push({ id: created.id, spec, email, qrSecret: created.qrSecret });
  }
  // One member whose data was erased on request (right-to-erasure), to show the anonymized state.
  const erasedPhone = "081299990000";
  await prisma.member.create({
    data: {
      gymId: gym.id,
      planId: plans[1].id,
      fullName: "Anggota Dihapus",
      email: `erased-${crypto.randomUUID()}@anonymized.invalid`,
      phoneWhatsapp: encrypt(erasedPhone),
      phoneWhatsappLookup: hmacLookup(erasedPhone + crypto.randomUUID()),
      status: "CANCELLED",
      anonymizedAt: ago(14 * DAY),
      createdAt: ago(200 * DAY),
    },
  });

  // ── Payments: membership history (drives Finance + dashboard revenue) ──
  let invoiceSeq = 1;
  const paid = (m: (typeof members)[number], when: Date, amount: number, planId: string, cash = false) =>
    prisma.payment.create({
      data: {
        gymId: gym.id,
        memberId: m.id,
        planId,
        provider: cash ? "CASH" : "XENDIT",
        externalInvoiceId: cash ? null : `showcase-inv-${invoiceSeq++}`,
        amount,
        status: "PAID",
        paidAt: when,
        createdAt: when,
        note: cash ? pick(["Bayar di kasir", "Transfer diterima, dicatat manual", "Tunai di front desk"], invoiceSeq) : null,
        recordedById: cash ? pick([staff1.id, staff2.id], invoiceSeq) : null,
      },
    });
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (m.spec.status === "PENDING_PAYMENT") continue;
    const plan = plans[m.spec.plan];
    const price = Number(plan.price);
    // The payment that created the current membership: started `durationDays` before expiry.
    const start = ahead((m.spec.expiryDays ?? 0) * DAY - plan.durationDays * DAY);
    await paid(m, start > now ? ago(2 * DAY) : start, price, plan.id, i % 4 === 0);
    // Earlier renewals for monthly-ish members, giving ~6 months of revenue trend.
    if (plan.durationDays <= 30 && m.spec.status !== "CANCELLED") {
      for (let k = 1; k <= 1 + (i % 5); k++) await paid(m, new Date(start.getTime() - k * 30 * DAY), price, plan.id, (i + k) % 5 === 0);
    }
  }
  // Some money landing today, so "today" and "this month" cards are never empty.
  const budi = members[0];
  const lala = members[5];
  await paid(budi, ago(3 * HOUR), 350_000, plans[1].id);
  await paid(lala, ago(1 * HOUR), 250_000, plans[4].id, true);
  // Open / failed invoices
  for (const m of members.filter((x) => x.spec.status === "PENDING_PAYMENT")) {
    const id = crypto.randomUUID();
    await prisma.payment.create({
      data: { id, gymId: gym.id, memberId: m.id, planId: plans[m.spec.plan].id, provider: "XENDIT", amount: plans[m.spec.plan].price, status: "PENDING", ...invoiceFor(id) },
    });
  }
  const tono = members[18];
  await prisma.payment.create({
    data: { gymId: gym.id, memberId: tono.id, planId: plans[1].id, provider: "XENDIT", externalInvoiceId: "showcase-inv-expired", amount: 350_000, status: "EXPIRED", createdAt: ago(8 * DAY) },
  });
  await prisma.payment.create({
    data: { gymId: gym.id, memberId: members[19].id, planId: plans[1].id, provider: "XENDIT", externalInvoiceId: "showcase-inv-failed", amount: 350_000, status: "FAILED", createdAt: ago(25 * DAY) },
  });

  // ── Check-ins ──
  const activeVisitors = members.filter((m) => m.spec.freq > 0 && m.spec.status !== "CANCELLED");
  const visitDays = new Map<string, Set<number>>();
  const rows: Prisma.CheckInCreateManyInput[] = [];
  const peakHours = [6, 7, 8, 12, 17, 18, 19, 20];
  activeVisitors.forEach((m, mi) => {
    const days = new Set<number>();
    for (let d = 60; d >= 1; d--) {
      // Lapsed members stop coming after they expired.
      if (m.spec.expiryDays !== null && m.spec.expiryDays < 0 && d < -m.spec.expiryDays) continue;
      const dow = new Date(now.getTime() - d * DAY).getDay();
      const weekendBoost = dow === 0 || dow === 6 ? 0.8 : 1;
      if (Math.random() < m.spec.freq * weekendBoost) days.add(d);
    }
    // Streak: visited every day for the last N days (through yesterday; today handled below).
    for (let d = 1; d <= (m.spec.streak ?? 0); d++) days.add(d);
    visitDays.set(m.id, days);
    for (const d of Array.from(days)) {
      const at = jakarta(-d, pick(peakHours, mi + d), (mi * 7 + d * 3) % 60);
      rows.push({ gymId: gym.id, memberId: m.id, staffUserId: (mi + d) % 3 === 0 ? null : pick([staff1.id, staff2.id], mi + d), checkedInAt: at, checkedOutAt: new Date(at.getTime() + (50 + ((mi * 11 + d) % 50)) * MIN), result: "SUCCESS" });
    }
  });
  await prisma.checkIn.createMany({ data: rows });

  // Today: a few already left, and a crowd currently in the gym (shows on the "who's in the gym" board).
  const inGym = [0, 1, 2, 3, 4, 6, 8].map((i) => members[i]);
  const earlier = [5, 9, 11].map((i) => members[i]);
  for (const [i, m] of Array.from(earlier.entries())) {
    const at = ago((300 + i * 40) * MIN);
    await prisma.checkIn.create({ data: { gymId: gym.id, memberId: m.id, staffUserId: staff1.id, checkedInAt: at, checkedOutAt: new Date(at.getTime() + 70 * MIN), result: "SUCCESS", deviceLabel: "Front Desk" } });
  }
  for (const [i, m] of Array.from(inGym.entries())) {
    await prisma.checkIn.create({
      data: { gymId: gym.id, memberId: m.id, staffUserId: i % 2 ? staff2.id : staff1.id, checkedInAt: ago((10 + i * 22) * MIN), result: "SUCCESS", deviceLabel: i % 3 === 0 ? "Self check-in (QR poster)" : "Front Desk" },
    });
  }
  // Rejections, so the check-in log shows every result type.
  const rejects: [number, CheckInResult, number][] = [
    [0, "DUPLICATE", 35], [2, "DUPLICATE", 80], [18, "EXPIRED", 120], [19, "EXPIRED", 400],
    [21, "FROZEN", 200], [22, "FROZEN", 3000], [20, "EXPIRED", 1500],
  ];
  for (const [mi, result, minsAgo] of rejects) {
    await prisma.checkIn.create({ data: { gymId: gym.id, memberId: members[mi].id, staffUserId: staff1.id, checkedInAt: ago(minsAgo * MIN), result, deviceLabel: "Front Desk" } });
  }

  // ── Classes ──
  const defs = [
    { name: "Zumba Pagi", instructor: "Coach Rina", price: 75_000, capacity: 20, durationMinutes: 60, description: "Zumba penuh energi — bakar kalori sambil bergoyang. Semua level." },
    { name: "Yoga Sore", instructor: "Coach Dewi", price: 100_000, capacity: 12, durationMinutes: 75, description: "Vinyasa flow untuk fleksibilitas dan ketenangan setelah seharian bekerja." },
    { name: "Muay Thai Dasar", instructor: "Coach Bayu", price: 150_000, capacity: 10, durationMinutes: 90, description: "Teknik dasar striking, footwork, dan kondisi fisik." },
    { name: "HIIT Gratis Member", instructor: "Coach Agus", price: 0, capacity: 15, durationMinutes: 45, description: "Sesi HIIT 45 menit, gratis untuk member aktif." },
    { name: "Spinning 45", instructor: "Coach Sinta", price: 90_000, capacity: 8, durationMinutes: 45, description: "Kelas indoor cycling dengan musik dan interval." },
    { name: "Pilates Reformer (Tidak Aktif)", instructor: "Coach Mira", price: 200_000, capacity: 6, durationMinutes: 60, description: "Sementara dihentikan.", isActive: false },
  ];
  const classes = [];
  for (const d of defs) classes.push(await prisma.gymClass.create({ data: { gymId: gym.id, currency: "IDR", ...d } }));
  const hourFor = [7, 18, 19, 17, 6];
  const sessions: { id: string; classIdx: number; day: number; full?: boolean }[] = [];
  for (let c = 0; c < 5; c++) {
    for (const day of [-6, -3, -1, 1, 2, 4, 6, 9]) {
      if ((c + day + 10) % 2 && day > 0 && day !== 1 && day !== 2) continue;
      const startsAt = jakarta(day, hourFor[c]);
      const past = startsAt < now;
      const s = await prisma.classSession.create({
        data: { gymId: gym.id, classId: classes[c].id, startsAt, status: past ? "COMPLETED" : "SCHEDULED" },
      });
      sessions.push({ id: s.id, classIdx: c, day });
    }
  }
  // One cancelled session (members were messaged, pending invoices expired).
  const cancelled = await prisma.classSession.create({
    data: { gymId: gym.id, classId: classes[1].id, startsAt: jakarta(3, 18), status: "CANCELLED" },
  });

  const regMembers = members.filter((m) => m.spec.status === "ACTIVE" && m.spec.activated !== false);
  let regCount = 0;
  for (const [si, s] of Array.from(sessions.entries())) {
    const cls = defs[s.classIdx];
    const past = s.day < 0;
    const fill = s.classIdx === 4 && s.day === 1 ? 8 : 3 + ((si * 3) % 6); // spinning tomorrow: full house
    for (let k = 0; k < fill && k < regMembers.length; k++) {
      const m = regMembers[(si * 2 + k) % regMembers.length];
      // PENDING: only on future paid classes. CANCELLED: occasionally.
      const state = !past && cls.price > 0 && k === fill - 1 && s.classIdx !== 4 ? "PENDING_PAYMENT" : k === 2 && si % 4 === 0 ? "CANCELLED" : "CONFIRMED";
      const registration = await prisma.classRegistration.create({
        data: {
          gymId: gym.id, sessionId: s.id, memberId: m.id, status: state,
          attendance: past && state === "CONFIRMED" ? (k % 5 === 4 ? "NO_SHOW" : "ATTENDED") : null,
          attendanceAt: past && state === "CONFIRMED" ? ago(Math.abs(s.day) * DAY) : null,
          createdAt: ago((Math.abs(s.day) + 2) * DAY),
        },
      });
      regCount++;
      if (cls.price === 0 || state === "CANCELLED") continue;
      const cpId = crypto.randomUUID();
      if (state === "PENDING_PAYMENT") {
        await prisma.classPayment.create({ data: { id: cpId, gymId: gym.id, registrationId: registration.id, provider: "XENDIT", amount: cls.price, status: "PENDING", ...invoiceFor(cpId) } });
      } else {
        const cash = k % 3 === 0;
        await prisma.classPayment.create({
          data: {
            gymId: gym.id, registrationId: registration.id, provider: cash ? "CASH" : "XENDIT",
            externalInvoiceId: cash ? null : `showcase-cls-${cpId}`, amount: cls.price, status: "PAID",
            paidAt: ago((Math.abs(s.day) + 1) * DAY), note: cash ? "Bayar di front desk" : null, recordedById: cash ? staff1.id : null,
          },
        });
      }
    }
  }
  void cancelled;

  // ── Self-signup requests (Members → Requests) ──
  const signupBase = { gymId: gym.id, passwordHash: await bcrypt.hash("calon123", 10), termsAcceptedAt: ago(1 * DAY) };
  const signups: [string, string, number, "PENDING_REVIEW" | "REJECTED" | "COMPLETED", string | null, string][] = [
    ["Kevin Alexander", "081277770001", 1, "PENDING_REVIEW", "https://mock-blob.local/proof-kevin.jpg", "kevin.alexander@gmail.com"],
    ["Melati Susanti", "081277770002", 2, "PENDING_REVIEW", null, "melati.susanti@gmail.com"],
    ["Oscar Pradipta", "081277770003", 4, "PENDING_REVIEW", "https://mock-blob.local/proof-oscar.jpg", "oscar.pradipta@gmail.com"],
    ["Tiara Anindya", "081277770004", 1, "REJECTED", "https://mock-blob.local/proof-tiara.jpg", "tiara.anindya@gmail.com"],
    ["Ucok Siregar", "081277770005", 3, "COMPLETED", "https://mock-blob.local/proof-ucok.jpg", "ucok.siregar@gmail.com"],
  ];
  for (const [fullName, phone, planIdx, status, proof, email] of signups) {
    await prisma.memberSignup.create({
      data: {
        ...signupBase, planId: plans[planIdx].id, fullName, email, phoneWhatsapp: encrypt(phone), phoneWhatsappLookup: hmacLookup(phone),
        amount: plans[planIdx].price, status, proofImageUrl: proof, kind: "JOIN",
        createdAt: ago((status === "PENDING_REVIEW" ? 3 : 30) * HOUR),
        completedAt: status === "PENDING_REVIEW" ? null : ago(20 * HOUR),
      },
    });
  }
  // A renewal request from an existing member.
  const renewer = members[16];
  await prisma.memberSignup.create({
    data: {
      gymId: gym.id, planId: plans[1].id, fullName: renewer.spec.name, email: renewer.email, phoneWhatsapp: encrypt(renewer.spec.phone),
      phoneWhatsappLookup: hmacLookup(renewer.spec.phone), passwordHash: null, kind: "RENEWAL", memberId: renewer.id, amount: plans[1].price,
      status: "PENDING_REVIEW", proofImageUrl: "https://mock-blob.local/proof-dewi.jpg", createdAt: ago(90 * MIN), termsAcceptedAt: ago(90 * MIN),
    },
  });

  // ── Magic links ──
  const links: { who: string; purpose: string; url: string }[] = [];
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  for (const idx of [23, 24, 25, 26]) {
    const { token, tokenHash } = generateMagicToken();
    await prisma.magicLink.create({ data: { memberId: members[idx].id, tokenHash, purpose: "activate", expiresAt: ahead(48 * HOUR) } });
    links.push({ who: members[idx].spec.name, purpose: "activate", url: `${appUrl}/activate/${token}` });
  }
  const fallbackMember = members[1];
  {
    const { token, tokenHash } = generateMagicToken();
    await prisma.magicLink.create({ data: { memberId: fallbackMember.id, tokenHash, purpose: "qr_fallback", expiresAt: ahead(7 * DAY) } });
    links.push({ who: fallbackMember.spec.name, purpose: "qr_fallback (view /my-qr without password)", url: `${appUrl}/my-qr?token=${token}` });
  }

  // ── Notification log ──
  const types: [string, string][] = [
    ["member_activation", "sent"], ["member_welcome", "sent"], ["expiry_reminder", "sent"], ["payment_confirmation", "sent"],
    ["class_confirmation", "sent"], ["expired_notice", "sent"], ["payment_reminder", "failed"],
  ];
  const logRows = Array.from({ length: 70 }, (_, i) => ({
    gymId: gym.id, memberId: members[i % members.length].id, type: types[i % types.length][0],
    status: i % 13 === 0 ? "failed" : types[i % types.length][1], sentAt: ago(i * 5 * HOUR),
  }));
  await prisma.notificationLog.createMany({ data: logRows });

  // ── Platform billing history (owner's Billing page) ──
  for (let m = 5; m >= 1; m--) {
    const when = ago(m * 30 * DAY - 18 * DAY);
    await prisma.platformPayment.create({
      data: { gymId: gym.id, saasPlanId: growth.id, provider: "xendit", kind: m === 5 ? "SETUP" : "SUBSCRIPTION", externalInvoiceId: `showcase-plat-${m}`, amount: m === 5 ? 500_000 : growth.price, status: "PAID", paidAt: when, createdAt: when },
    });
  }
  const upcomingId = crypto.randomUUID();
  await prisma.platformPayment.create({
    data: { id: upcomingId, gymId: gym.id, saasPlanId: growth.id, provider: "xendit", kind: "SUBSCRIPTION", amount: growth.price, status: "PENDING", ...invoiceFor(upcomingId) },
  });

  await prisma.auditLog.create({ data: { superadminId, gymId: gym.id, action: "gym.create", metadata: { name: gym.name, slug: gym.slug }, createdAt: ago(200 * DAY) } });

  return { gym, owner, staff1, plans, members, fallbackMember, links, regCount };
}

/** Smaller tenants so the superadmin list, MRR and lifecycle states have something to show. */
async function seedOtherGyms(saas: Awaited<ReturnType<typeof ensureSaasPlans>>, superadminId: string) {
  const hash = await bcrypt.hash(STAFF_PASSWORD, 10);
  const memberHash = await bcrypt.hash(MEMBER_PASSWORD, 10);
  const specs = [
    { slug: "fit-nusantara", name: "Fit Nusantara Bandung", plan: "Starter Monthly", status: "ACTIVE", life: false, members: 34, owner: "Ibu Ratih Kartika", city: "Bandung" },
    { slug: "iron-borneo", name: "Iron Borneo Gym", plan: "Growth Annual", status: "ACTIVE", life: false, members: 62, owner: "Pak Yohanes Lim", city: "Balikpapan" },
    { slug: "bali-strong", name: "Bali Strong Studio", plan: "Solo Monthly", status: "TRIALING", life: false, members: 6, owner: "Bli Made Wirawan", city: "Denpasar" },
    { slug: "arena-otot", name: "Arena Otot Surabaya", plan: "Starter Monthly", status: "PAST_DUE", life: false, members: 41, owner: "Pak Slamet Riyadi", city: "Surabaya" },
    { slug: "kampung-sehat", name: "Gym Kampung Sehat", plan: "Solo Monthly", status: "SUSPENDED", life: false, members: 12, owner: "Pak Darmo", city: "Yogyakarta" },
    { slug: "warung-fitness", name: "Warung Fitness Legacy (Founding Partner)", plan: "Pro Annual", status: "ACTIVE", life: true, members: 18, owner: "Pak Anton Gunadi", city: "Semarang" },
  ] as const;

  for (const [gi, s] of Array.from(specs.entries())) {
    const plan = await saas.byName(s.plan);
    const gym = await prisma.gym.create({
      data: {
        name: s.name, slug: s.slug, saasPlanId: plan.id, subscriptionStatus: s.status, isLifetime: s.life, termsAcceptedAt: ago(100 * DAY),
        nextBillingDate: s.life || s.status === "TRIALING" ? null : s.status === "PAST_DUE" ? ago(2 * DAY) : ahead((5 + gi * 4) * DAY),
        address: `Kota ${s.city}`, description: `Pusat kebugaran di ${s.city}.`,
        settings: s.status === "SUSPENDED" ? { suspendedFor: "non_payment" } : {},
        createdAt: ago((220 - gi * 25) * DAY),
      },
    });
    const first = s.owner.split(" ").slice(1).join(".").toLowerCase();
    await prisma.staffUser.create({ data: { gymId: gym.id, name: s.owner, email: `${first}@${s.slug}.id`, passwordHash: hash, role: "OWNER" } });
    const mp = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Bulanan", durationDays: 30, price: 300_000 } });
    // A handful of real member rows (counts show on /superadmin/gyms); the rest would just be noise.
    for (let i = 0; i < Math.min(s.members, 8); i++) {
      const phone = `0813${String(gi)}${String(1000 + i)}00`;
      await prisma.member.create({
        data: {
          gymId: gym.id, planId: mp.id, fullName: pick(["Agung", "Bintang", "Cahya", "Dian", "Eka", "Fitri", "Gilang", "Hana"], i) + " " + s.city,
          email: `member${i}@${s.slug}.id`, phoneWhatsapp: encrypt(phone), phoneWhatsappLookup: hmacLookup(phone), passwordHash: memberHash,
          status: "ACTIVE", membershipExpiry: ahead((5 + i * 3) * DAY),
        },
      });
    }
    // Platform revenue: recurring for normal gyms, one-time (kept out of MRR) for the lifetime deal.
    if (s.life) {
      await prisma.platformPayment.create({ data: { gymId: gym.id, saasPlanId: plan.id, provider: "manual", kind: "SETUP", amount: 15_000_000, status: "PAID", paidAt: ago(150 * DAY), createdAt: ago(150 * DAY) } });
    } else if (s.status !== "TRIALING") {
      const count = s.status === "SUSPENDED" ? 2 : 5;
      for (let m = count; m >= 1; m--) {
        const when = ago(m * 30 * DAY);
        await prisma.platformPayment.create({ data: { gymId: gym.id, saasPlanId: plan.id, provider: "xendit", amount: plan.price, status: "PAID", paidAt: when, createdAt: when } });
      }
      if (s.status === "PAST_DUE" || s.status === "SUSPENDED") {
        const id = crypto.randomUUID();
        await prisma.platformPayment.create({ data: { id, gymId: gym.id, saasPlanId: plan.id, provider: "xendit", amount: plan.price, status: s.status === "PAST_DUE" ? "PENDING" : "EXPIRED", ...invoiceFor(id) } });
      }
    }
    await prisma.auditLog.create({ data: { superadminId, gymId: gym.id, action: "gym.create", metadata: { name: gym.name, slug: gym.slug }, createdAt: gym.createdAt } });
    if (s.status === "SUSPENDED") {
      await prisma.auditLog.create({ data: { superadminId, gymId: gym.id, action: "gym.suspend", metadata: { reason: "non_payment" }, createdAt: ago(6 * DAY) } });
    }
  }
  // A suspend → reactivate pair on the star tenant's neighbour, so the audit trail has both directions.
  const fit = await prisma.gym.findUniqueOrThrow({ where: { slug: "fit-nusantara" } });
  await prisma.auditLog.createMany({
    data: [
      { superadminId, gymId: fit.id, action: "gym.suspend", metadata: {}, createdAt: ago(40 * DAY) },
      { superadminId, gymId: fit.id, action: "gym.reactivate", metadata: {}, createdAt: ago(39 * DAY) },
    ],
  });

  // Would-be gyms from the public /signup page.
  const sp = await saas.byName("Starter Monthly");
  await prisma.gymSignup.createMany({
    data: [
      { gymName: "Sehat Bugar Medan", slug: "sehat-bugar-medan", ownerName: "Ibu Lina Marpaung", ownerEmail: "lina@sehatbugar.id", ownerPhone: "081355550001", passwordHash: hash, saasPlanId: sp.id, status: "PENDING", createdAt: ago(2 * HOUR), termsAcceptedAt: ago(2 * HOUR) },
      { gymName: "Bumi Fit Makassar", slug: "bumi-fit-makassar", ownerName: "Pak Daeng Rate", ownerEmail: "daeng@bumifit.id", ownerPhone: "081355550002", passwordHash: hash, saasPlanId: sp.id, status: "CONFLICT", createdAt: ago(3 * DAY), termsAcceptedAt: ago(3 * DAY) },
    ],
  });
}

async function main() {
  await wipe();
  const saas = await ensureSaasPlans();
  const superadmin = await ensureSuperadmin();
  await prisma.appConfig.upsert({ where: { key: "theme.default" }, update: {}, create: { key: "theme.default", value: "dark" } });

  const main_ = await seedMainGym(saas, superadmin.id);
  await seedOtherGyms(saas, superadmin.id);

  const star = main_.members[0];
  const qrToken = buildQrToken({ gymId: main_.gym.id, memberId: star.id, issuedAt: Date.now() }, star.qrSecret);
  const expiredQr = main_.members[18];
  const frozenQr = main_.members[21];
  const tokenFor = (m: (typeof main_.members)[number]) => buildQrToken({ gymId: main_.gym.id, memberId: m.id, issuedAt: Date.now() }, m.qrSecret);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

  const line = "─".repeat(72);
  console.log(`\n${line}\n  SHOWCASE SEED COMPLETE — Gym Garuda Perkasa\n${line}`);
  console.log(`\nSuperadmin   ${appUrl}/superadmin/login\n  ${SUPERADMIN_EMAIL} / ${SUPERADMIN_PASSWORD}`);
  console.log(`\nOwner        ${appUrl}/${MAIN_SLUG}/login\n  owner@garudaperkasa.id / ${STAFF_PASSWORD}   (sees billing, finance, staff, settings)`);
  console.log(`Staff        ayu@garudaperkasa.id / ${STAFF_PASSWORD}   (no billing — gets 403)`);
  console.log(`             rudi@garudaperkasa.id / ${STAFF_PASSWORD}`);
  console.log(`\nMember       ${appUrl}/${MAIN_SLUG}/member-login   (password: ${MEMBER_PASSWORD})`);
  console.log(`  ${star.email}   ← star member: 12-day streak, on the leaderboard, classes booked`);
  console.log(`  ${main_.members[1].email}   ← annual member`);
  console.log(`\nPublic gym page      ${appUrl}/${MAIN_SLUG}`);
  console.log(`Join page            ${appUrl}/${MAIN_SLUG}/join   (member self-signup, bank transfer)`);
  console.log(`Self check-in poster ${appUrl}/${MAIN_SLUG}/join-poster   station token: ${buildStationToken(main_.gym.id)}`);
  console.log(`\nQR tokens to scan/paste at /${MAIN_SLUG}/checkin:`);
  console.log(`  SUCCESS-ish  (${star.spec.name}; already in gym today → shows DUPLICATE, scan a member who isn't in yet for SUCCESS):`);
  console.log(`    ${qrToken}`);
  console.log(`  A fresh SUCCESS: ${main_.members[7].spec.name} (not checked in today)`);
  console.log(`    ${tokenFor(main_.members[7])}`);
  console.log(`  EXPIRED:     ${expiredQr.spec.name}\n    ${tokenFor(expiredQr)}`);
  console.log(`  FROZEN:      ${frozenQr.spec.name}\n    ${tokenFor(frozenQr)}`);
  console.log(`  INVALID (cross-tenant): scan a token from another gym's member, or edit any token's last char`);
  console.log(`\nMagic links (valid now):`);
  for (const l of main_.links) console.log(`  [${l.purpose}] ${l.who}\n    ${l.url}`);
  console.log(`\nOther tenants (superadmin → Gyms), all with owner password ${STAFF_PASSWORD}:`);
  for (const s of OTHER_SLUGS) console.log(`  ${appUrl}/${s}/login`);
  console.log(`  states covered: ACTIVE, TRIALING, PAST_DUE, SUSPENDED (non-payment), lifetime/founding (excluded from MRR)`);
  console.log(`\nIDs: gym ${main_.gym.id}  owner ${main_.owner.id}  superadmin ${superadmin.id}`);
  console.log(`Members: ${main_.members.length}   Class registrations: ${main_.regCount}\n${line}\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
