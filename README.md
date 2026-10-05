# Repstack

Gym management for small and mid-sized gyms in Indonesia: members, QR check-in, plans and
payments, classes, WhatsApp notifications and the owner's finances, in one web app. Multi-tenant
SaaS: one deployment serves many gyms, each at `repstack.com/<slug>`, and the platform operator
bills the gyms.

Built with Next.js 14 (App Router), TypeScript, Prisma on PostgreSQL, Tailwind, and Playwright
for end-to-end tests. Deployed on Vercel.

## What it does

**For gym owners and staff** (`/<slug>/…`)

- Members: add one at a time, import a spreadsheet, export the roster as CSV. Activation links,
  password resets and fallback QR links go out over WhatsApp (and optionally email).
- Check-in: members scan a printed station QR with their phone, or staff scan the member's QR.
  One visit per member per day; expired or frozen memberships are refused. "Who's in the gym now"
  on the dashboard, with check-out.
- Plans and payments: membership plans, cash or transfer payments recorded at the desk, online
  invoices through Xendit or Midtrans when switched on, voids, receipts.
- Join and renew by bank transfer: a public join page and a member renewal form that file requests
  with a transfer screenshot; staff confirm them from one queue.
- Classes: class types, weekly sessions, member booking with seat limits, desk or online payment,
  attendance marking, reminders three hours before.
- Finance: revenue by month, by plan or class, by method; CSV exports for the bookkeeper.
- Settings: public profile page and photos, bank details, notification channels, the gym's own
  WhatsApp number, occupancy window, member leaderboard, theme.

**For members** (`/my`)

Dashboard with membership status, visit history and streaks, the gym leaderboard when the owner
turns it on, class booking, renewal, their check-in QR, and account deletion.

**For the platform operator** (`/superadmin`)

Create and suspend gym tenants, set an optional one-time setup fee, see MRR and setup fees,
manage SaaS plans. Gym subscriptions are invoiced by a daily cron when online payments are on.

## Local setup

Requirements: Node 20, PostgreSQL 16.

```bash
npm install
cp .env.example .env            # fill in at least DATABASE_URL and the four secrets
npm run db:migrate:dev          # apply migrations
APP_DB_PASSWORD='a-long-random-password' npm run db:rls   # restricted app role + row-level security
npm run db:seed                 # demo gym, plans, a superadmin and a member; prints the logins
npm run dev
```

Then open `http://localhost:3000`. The seed prints the superadmin, demo owner and demo member
credentials. For a production superadmin use `npm run admin -- create --email you@example.com --name "You"`
with the password in `SUPERADMIN_PASSWORD`.

Set `PAYMENTS_MOCK=1`, `WHATSAPP_MOCK=1` and `EMAIL_MOCK=1` in development to fake the payment
provider, WhatsApp and email. Every flow then works end to end with no external accounts.

### Environment

All variables are listed with comments in `.env.example`. The ones that must be set:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres, as the database owner. Used for auth, webhooks, cron and superadmin. |
| `APP_DATABASE_URL` | Postgres, as the restricted role created by `db:rls`. Used for every gym-scoped query. |
| `JWT_SECRET` | Signs session cookies. |
| `QR_SERVER_SECRET` | Signs check-in QR tokens. |
| `ENCRYPTION_KEY` | AES-256-GCM key for member phone numbers and gym WhatsApp tokens at rest. |
| `LOOKUP_HMAC_KEY` | Blind index for phone lookups. |
| `CRON_SECRET` | Bearer token the cron routes require. |
| `NEXT_PUBLIC_APP_URL` | Public origin, used in links sent to people. |

Payments, WhatsApp, email and Vercel Blob are optional until you want them. See `PAYMENTS.md`
for the payment switches and provider setup.

## Tests

```bash
cp .env.test.example .env.test   # points at a disposable database; never run against prod
npm run test:e2e
```

The Playwright suite resets the test database, applies row-level security and seeds fixtures,
then runs every spec in `e2e/` against a dev server on port 3100. It covers tenant isolation,
check-in rules, payments and webhooks, imports and exports, classes, and the browser flows.
CI runs the type check and the full suite on every push and pull request to `main`.

## Deploying

Vercel, with Neon or any Postgres. Before new code goes live:

```bash
npm run db:migrate   # applies pending migrations, never resets
npm run db:rls       # idempotent; grants the app role on any new tables
```

Cron routes are declared in `vercel.json`: daily subscription billing, daily member expiry
reminders, hourly class reminders. See `prisma/MIGRATIONS.md` for the schema workflow.

## How tenancy is enforced

Every gym-scoped page and API route goes through `requireTenantSession(slug)`, which verifies the
session, checks it belongs to the gym in the URL, and hands back a Prisma client bound to that
gym. Underneath, Postgres row-level security keyed on `gymId` makes the same guarantee, so a
missing filter in some future query cannot leak another gym's data. `prisma/RLS.md` explains the
two-role model and how to check it is active.

Member phone numbers and gym WhatsApp credentials are encrypted at rest. Member email is the login
identifier and is globally unique across gyms.

## Repository map

| Path | What is there |
|---|---|
| `src/app/[slug]/` | Gym back office: dashboard, members, classes, plans, finance, billing, settings, check-in |
| `src/app/my/`, `src/app/my-qr/`, `src/app/check-in/` | Member pages |
| `src/app/superadmin/` | Platform operator |
| `src/app/api/` | Route handlers, including webhooks and cron |
| `src/lib/` | Session, tenancy, crypto, payments gateway, WhatsApp, CSV, stats |
| `src/lib/validation/` | Zod schemas for every request body |
| `prisma/` | Schema, migrations, RLS policies, seed and admin scripts |
| `e2e/` | Playwright specs and fixtures |

Other docs: `PAYMENTS.md` (payment providers and switches), `PLANNED_FEATURES.md` (feature map
for the gym profile page and classes), `prisma/RLS.md`, `prisma/MIGRATIONS.md`.
