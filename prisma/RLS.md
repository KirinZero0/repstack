# Row-Level Security hardening (optional pre-go-live, required before second tenant)

Application code enforces tenant isolation today via `requireTenantSession(slug)`
(`src/lib/session.ts`) — every gym-scoped query filters by `gymId` taken from the verified
session, never from a client-supplied value. This is sufficient for a single paying tenant
where the only code path touching the database is this app.

Before onboarding a **second real paying tenant**, add Postgres RLS as defense-in-depth: a bug
in a future query (missing a `where: { gymId }` clause) would otherwise leak data across tenants
silently. RLS makes that a hard database-level failure instead.

## How it works

1. Every tenant-scoped table gets a policy that only allows rows where `gym_id` matches
   `current_setting('app.current_gym_id')`.
2. The app sets that session variable at the start of each request, right after
   `requireTenantSession` resolves the gym — e.g. via `SET LOCAL app.current_gym_id = $1`
   inside a transaction, or a Prisma `$executeRaw` call before the query. Prisma's connection
   pooling means this must be set per-transaction, not per-connection.
3. Superadmin routes and the `Superadmin`/`SaasPlan` tables are exempt — they intentionally
   see across all tenants — and should run as a Postgres role that bypasses RLS
   (`BYPASSRLS`) or against a policy that allows `current_setting('app.is_superadmin', true) = 'true'`.

## SQL (apply via a migration once ready)

```sql
-- Enable RLS on every tenant-scoped table.
ALTER TABLE "Gym" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckIn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsappSenderConfig" ENABLE ROW LEVEL SECURITY;

-- Gym itself is matched on its own id, not a gym_id column.
CREATE POLICY tenant_isolation_gym ON "Gym"
  USING (
    current_setting('app.is_superadmin', true) = 'true'
    OR id::text = current_setting('app.current_gym_id', true)
  );

-- Every other tenant-scoped table follows this shape (repeat per table, substituting the name):
CREATE POLICY tenant_isolation_staffuser ON "StaffUser"
  USING (
    current_setting('app.is_superadmin', true) = 'true'
    OR "gymId"::text = current_setting('app.current_gym_id', true)
  );

CREATE POLICY tenant_isolation_membershipplan ON "MembershipPlan"
  USING (
    current_setting('app.is_superadmin', true) = 'true'
    OR "gymId"::text = current_setting('app.current_gym_id', true)
  );

CREATE POLICY tenant_isolation_member ON "Member"
  USING (
    current_setting('app.is_superadmin', true) = 'true'
    OR "gymId"::text = current_setting('app.current_gym_id', true)
  );

CREATE POLICY tenant_isolation_checkin ON "CheckIn"
  USING (
    current_setting('app.is_superadmin', true) = 'true'
    OR "gymId"::text = current_setting('app.current_gym_id', true)
  );

CREATE POLICY tenant_isolation_payment ON "Payment"
  USING (
    current_setting('app.is_superadmin', true) = 'true'
    OR "gymId"::text = current_setting('app.current_gym_id', true)
  );

CREATE POLICY tenant_isolation_notificationlog ON "NotificationLog"
  USING (
    current_setting('app.is_superadmin', true) = 'true'
    OR "gymId"::text = current_setting('app.current_gym_id', true)
  );

CREATE POLICY tenant_isolation_whatsappconfig ON "WhatsappSenderConfig"
  USING (
    current_setting('app.is_superadmin', true) = 'true'
    OR "gymId"::text = current_setting('app.current_gym_id', true)
  );
```

## App-side wiring (not yet implemented)

`requireTenantSession` would need to run its Prisma calls inside a transaction that opens with:

```ts
await tx.$executeRawUnsafe(`SET LOCAL app.current_gym_id = '${gym.id}'`);
```

(parameterized properly, not string-interpolated as shown — `SET LOCAL` doesn't accept bind
parameters directly, so use `set_config('app.current_gym_id', $1, true)` via `$queryRaw`
instead). This is a non-trivial refactor of every Prisma call site into transactions and is
**deliberately deferred** past tonight's scope — the brief calls it a hardening step, not a
go-live blocker, for a single-tenant launch.

## Why this file exists but isn't applied yet

Applying RLS without the app-side `SET LOCAL` wiring would break the app (every query would
return zero rows once RLS is enabled, since `current_setting` would be unset). Ship this as a
tracked follow-up, not a partial migration.
