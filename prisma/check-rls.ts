/**
 * Proves row-level security is actually enforced for the application role.
 *
 *   npm run db:rls:check
 *
 * Needs DATABASE_URL (owner) and APP_DATABASE_URL (restricted role). If APP_DATABASE_URL points
 * at an owner/superuser, RLS is silently bypassed, which is exactly what this catches.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const TENANT_TABLES = ["Gym", "StaffUser", "MembershipPlan", "Member", "CheckIn", "Payment", "NotificationLog", "WhatsappSenderConfig", "PlatformPayment", "MemberSignup"];
const NOT_GRANTED = ["Superadmin", "AuditLog", "GymSignup", "MagicLink", "PasswordReset", "AppConfig"];

let failures = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const appUrl = process.env.APP_DATABASE_URL;
  if (!appUrl) {
    console.error("APP_DATABASE_URL is not set, so there is nothing to check.");
    process.exit(1);
  }
  const owner = new PrismaClient();
  const app = new PrismaClient({ datasources: { db: { url: appUrl } } });

  try {
    const [me] = await app.$queryRaw<{ user: string; super: boolean; bypass: boolean }[]>`
      SELECT current_user AS "user", r.rolsuper AS super, r.rolbypassrls AS bypass FROM pg_roles r WHERE r.rolname = current_user`;
    check(!me.super && !me.bypass, `connected as "${me.user}" with no superuser / BYPASSRLS`, `super=${me.super} bypassrls=${me.bypass}`);

    const rls = await owner.$queryRaw<{ relname: string; on: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS "on" FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    const enabled = new Set(rls.filter((r) => r.on).map((r) => r.relname));
    for (const t of TENANT_TABLES) check(enabled.has(t), `RLS enabled on "${t}"`);

    for (const t of NOT_GRANTED) {
      const denied = await app.$queryRawUnsafe(`SELECT 1 FROM "${t}" LIMIT 1`).then(() => false, () => true);
      check(denied, `"${t}" is not readable by the app role`);
    }

    const gyms = await owner.gym.findMany({ take: 3, orderBy: { createdAt: "asc" } });
    const total = await owner.member.count();
    const [noContext] = await app.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "Member"`;
    check(Number(noContext.n) === 0, "with no gym set, the app role sees zero members", `saw ${noContext.n} of ${total}`);

    for (const gym of gyms) {
      const expected = await owner.member.count({ where: { gymId: gym.id } });
      const seen = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_gym_id', ${gym.id}, TRUE)`;
        return tx.$queryRaw<{ gymId: string }[]>`SELECT "gymId" FROM "Member"`;
      });
      check(seen.length === expected && seen.every((m) => m.gymId === gym.id), `gym "${gym.slug}": sees exactly its own ${expected} members`, `saw ${seen.length}`);
    }

    if (gyms.length >= 2) {
      const [a, b] = gyms;
      const plan = await owner.membershipPlan.findFirst({ where: { gymId: b.id } });
      if (plan) {
        const blocked = await app
          .$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.current_gym_id', ${a.id}, TRUE)`;
            await tx.$executeRaw`INSERT INTO "MembershipPlan" (id, "gymId", name, "durationDays", price) VALUES (gen_random_uuid()::text, ${b.id}, 'rls-probe', 1, 1)`;
          })
          .then(() => false, () => true);
        check(blocked, `gym "${a.slug}" cannot write rows into gym "${b.slug}"`);
      }
    } else {
      console.log("SKIP  cross-gym write check (needs at least two gyms)");
    }
  } finally {
    await owner.$disconnect();
    await app.$disconnect();
  }

  console.log(failures === 0 ? "\nRow-level security is enforced.\n" : `\n${failures} check(s) failed. Row-level security is NOT fully enforced.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
