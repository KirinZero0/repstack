import { PrismaClient, type Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; rlsPrisma?: PrismaClient };

/**
 * System client: connects as the database owner (DATABASE_URL) and is NOT restricted by
 * row-level security. Use it only where there is no gym yet or the work is deliberately
 * cross-tenant: login, public sign-up/join, payment webhooks, cron, superadmin, theme lookup,
 * and the internal helpers those call (WhatsApp, magic links, password resets).
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

const appUrl = process.env.APP_DATABASE_URL;

/** True when tenant queries run as the restricted role, i.e. Postgres itself enforces isolation. */
export const rlsEnforced = Boolean(appUrl);

if (process.env.NODE_ENV === "production" && !appUrl) {
  console.error(
    "APP_DATABASE_URL is not set: tenant queries are running as the database owner, so row-level security is NOT being enforced. See prisma/RLS.md.",
  );
}

/** Restricted client: connects as the RLS-subject role (falls back to DATABASE_URL in local dev). */
const rlsBase =
  globalForPrisma.rlsPrisma ?? new PrismaClient(appUrl ? { datasources: { db: { url: appUrl } } } : undefined);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.rlsPrisma = rlsBase;
}

/**
 * A client whose every query runs with `app.current_gym_id` set to `gymId`, so the database only
 * shows and accepts rows for that gym. Take the id from a verified session, never from the client.
 * Each operation runs as a tiny transaction (set the setting, then the query) on one connection,
 * which is what keeps this safe with pooled connections.
 */
export function tenantDb(gymId: string) {
  return rlsBase.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await rlsBase.$transaction([
            rlsBase.$executeRaw`SELECT set_config('app.current_gym_id', ${gymId}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;

/** Several statements that must succeed or fail together, all confined to one gym. */
export function tenantTransaction<T>(gymId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return rlsBase.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_gym_id', ${gymId}, TRUE)`;
    return fn(tx);
  });
}
