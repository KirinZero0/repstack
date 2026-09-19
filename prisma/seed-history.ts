import { PrismaClient } from "@prisma/client";
import { encrypt, hmacLookup } from "../src/lib/crypto";

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

/** Adds fake history to the demo gym so the finance/attendance dashboards have something to show. */
async function main() {
  const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: "demo" }, include: { plans: true, saasPlan: true } });
  const monthly = gym.plans.find((p) => p.name === "Monthly")!;
  const annual = gym.plans.find((p) => p.name === "Annual")!;

  const names = ["Budi Santoso", "Sari Dewi", "Andi Wijaya", "Rina Putri", "Dimas Pratama", "Lala Kusuma", "Eko Nugroho", "Maya Sari"];
  const members = [];
  for (let i = 0; i < names.length; i++) {
    const phone = `08129999${String(1000 + i)}`;
    const email = `history${i}@demo.ironledger.dev`;
    const existing = await prisma.member.findUnique({ where: { email } });
    members.push(
      existing ??
        (await prisma.member.create({
          data: {
            gymId: gym.id,
            planId: i % 4 === 0 ? annual.id : monthly.id,
            fullName: names[i],
            email,
            phoneWhatsapp: encrypt(phone),
            phoneWhatsappLookup: hmacLookup(phone),
            status: "ACTIVE",
            membershipExpiry: new Date(Date.now() + (5 + i * 6) * DAY),
          },
        })),
    );
  }

  // Paid membership payments spread over the last ~6 months (growing trend), plus a few pending.
  for (let m = 5; m >= 0; m--) {
    const count = 2 + (5 - m);
    for (let k = 0; k < count; k++) {
      const member = members[(k + m) % members.length];
      const plan = k % 5 === 0 ? annual : monthly;
      const when = new Date(Date.now() - m * 30 * DAY - k * DAY);
      await prisma.payment.create({
        data: { gymId: gym.id, memberId: member.id, planId: plan.id, provider: "XENDIT", amount: plan.price, status: "PAID", paidAt: when, createdAt: when },
      });
    }
  }
  for (let k = 0; k < 2; k++) {
    await prisma.payment.create({
      data: { gymId: gym.id, memberId: members[k].id, planId: monthly.id, provider: "XENDIT", amount: monthly.price, status: "PENDING" },
    });
  }

  // Platform payments for the demo gym over the past 5 months.
  for (let m = 4; m >= 0; m--) {
    const when = new Date(Date.now() - m * 30 * DAY);
    await prisma.platformPayment.create({
      data: { gymId: gym.id, saasPlanId: gym.saasPlanId, provider: "xendit", amount: gym.saasPlan.price, status: "PAID", paidAt: when, createdAt: when },
    });
  }

  // Attendance: the seeded demo member visits ~4x/week for 12 weeks, plus a streak up to today.
  const demoMember = await prisma.member.findUniqueOrThrow({ where: { email: "member@demo.ironledger.dev" } });
  for (let d = 84; d >= 1; d--) {
    const dow = new Date(Date.now() - d * DAY).getDay();
    const visit = d <= 4 || [1, 2, 4, 6].includes(dow) ? Math.random() > 0.2 : false;
    if (!visit) continue;
    await prisma.checkIn.create({
      data: { gymId: gym.id, memberId: demoMember.id, result: "SUCCESS", checkedInAt: new Date(Date.now() - d * DAY - Math.random() * 3 * 3600_000) },
    });
  }

  console.log("Demo history added: members, payments, platform payments, check-ins.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
