# Row-level security

Repstack keeps gyms apart in two layers. Application code always filters by the gym in the
verified session (`requireTenantSession`), and Postgres enforces the same rule underneath, so a
missing `where gymId` in some future query can't leak another gym's data.

## How it works

The app connects to Postgres two ways:

| Client | Connects as | RLS | Used for |
|---|---|---|---|
| `prisma` (`src/lib/prisma.ts`) | database owner (`DATABASE_URL`) | bypassed | login, public sign-up/join/forgot-password, webhooks, cron, superadmin, theme lookup, and the internal helpers those call (WhatsApp, magic links, password resets) |
| `tenantDb(gymId)` | restricted role (`APP_DATABASE_URL`) | enforced | every gym-scoped page and API route (staff and member sessions) |

`requireTenantSession()` returns a ready-made `db = tenantDb(gym.id)`. Member-session code calls
`tenantDb(session.gymId)`. **Always take the gym id from a verified session, never from the client.**

Each query through `tenantDb` runs as a tiny transaction that first executes
`set_config('app.current_gym_id', <gym>, true)` on the same connection, then the query. That is
what makes it safe with pooled connections (including Neon's pooler): the setting only lives for
that transaction. Multi-statement work uses `tenantTransaction(gymId, tx => ...)`.

The policies (`prisma/rls.sql`) allow a row only when its `gymId` (or `id` for `Gym`) equals
`current_setting('app.current_gym_id', true)`, for reads and writes. With no gym set the comparison is
NULL, so the restricted role sees nothing and can write nothing.

The restricted role is also only **granted** the tables gym code needs. `Superadmin`, `AuditLog`,
`GymSignup`, `MagicLink`, `PasswordReset` and `AppConfig` are not readable by it at all. `MemberSignup`
is granted: staff review and approve/reject manual join requests through `tenantDb`/`tenantTransaction`,
same as any other tenant table. The public, unauthenticated write path in `/api/[slug]/join` still
uses the owner client, since there's no session yet to take a gym id from.

## Setting it up

RLS is only real if `APP_DATABASE_URL` connects as a role that is **not** the table owner, not a
superuser and does not have `BYPASSRLS`. If it points at the owner, Postgres skips the policies
silently. The check script below catches that.

1. With `DATABASE_URL` set to the database owner, create the role and apply the policies:

   ```bash
   APP_DB_PASSWORD='a-long-random-password' npm run db:rls
   ```

   Re-run it after every schema change that adds tables (`prisma migrate reset` drops
   policies). It is idempotent, and re-running with a new password rotates the role's password.

2. Set `APP_DATABASE_URL` to a connection string for that role, same host and database:

   ```
   postgresql://iron_app:<password>@<host>/<db>?sslmode=require
   ```

   On Neon use the **pooled** host for this URL and add `&pgbouncer=true` so Prisma disables
   prepared statements. Keep `DATABASE_URL` pointing at the owner (use the direct host for it if you run
   migrations).

3. Verify:

   ```bash
   npm run db:rls:check
   ```

   It fails loudly if the role is a superuser or has `BYPASSRLS`, if a tenant table lacks a policy, if
   the role can see rows with no gym set, if a gym sees another gym's rows, or if it can write
   into another gym.

In production the app logs an error at startup if `APP_DATABASE_URL` is missing, since tenant queries
would then run as the owner with RLS not enforced. Local development works without it (it falls back to
`DATABASE_URL`), but the e2e suite always runs with the restricted role.

## Adding a table

- Has a `gymId` column and holds gym data: add `ENABLE ROW LEVEL SECURITY`, a `tenant_isolation`
  policy and a `GRANT` in `prisma/rls.sql`, and add it to `check-rls.ts`.
- System-only (the app role must never touch it): leave it ungranted and add it to `SYSTEM_ONLY` in
  `e2e/15-row-level-security.spec.ts`.

The e2e test "every table with a gymId column is protected" fails until you do one of these.

## What this does not cover

- Code that uses the owner `prisma` client is not restricted. Those paths are deliberately limited to the
  places listed above and take ids that were already verified. Prefer `tenantDb` for anything new that
  handles one gym's data.
- Helpers like `sendGymWhatsapp` run as the owner but are only ever handed ids that a gym-scoped handler
  already authorised.
- It protects data at rest in the database, not the application logic: authorisation such as owner vs
  staff is still enforced in code.
