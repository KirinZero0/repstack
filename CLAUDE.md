# Liftmora — Build Brief for Claude Code

## What this is

A multi-tenant gym management SaaS. Build tonight's scope only — core functionality, tested end-to-end. Do NOT build "who's in the gym" (live occupancy) or leaderboard features — those are explicitly deferred to a later phase.

Single Next.js repo, deployed to Vercel. No separate backend, no native app.

## Stack

- Next.js 14 (App Router), TypeScript
- Prisma + PostgreSQL (Neon)
- Tailwind CSS
- `html5-qrcode` (browser camera QR scanning) + `qrcode` (QR generation)
- Xendit (invoices — used for both platform subscription billing AND member billing)
- WhatsApp via Fonnte (or Wablas) — abstracted behind a gateway wrapper
- Vercel Blob (private) for member profile pictures
- bcryptjs (password hashing), jsonwebtoken (session cookies), zod (input validation)
- Playwright for e2e tests

## The business model (context for why the schema looks the way it does)

Two separate billing relationships:
1. **Platform layer**: Gym Owner pays the Superadmin (you) a SaaS subscription — monthly or annual.
2. **Tenant layer**: Gym Member pays their Gym Owner for their own membership — unchanged concept, per-gym plans.

Three distinct identities, NOT one unified `User` table (deliberate — see rationale below):

| Table | Has password? | Scoped to a gym? | Login method |
|---|---|---|---|
| `Superadmin` | Yes | No — sees all tenants | Email/password at `/superadmin/login` |
| `StaffUser` (role: `OWNER` \| `STAFF`) | Yes | Yes — one `gymId` | Email/password at `/g/[slug]/login` |
| `Member` | Yes | Yes — one `gymId` | Email/password at `/g/[slug]/member-login` |

Rationale for NOT merging into one table: Superadmin has no gym (nullable `gymId` everywhere is a bug magnet), and each identity has a different lifecycle. Owner and Staff correctly share one table because they share a login flow, gym scope, and lifecycle — permission differences (e.g. only OWNER sees billing) are `role` checks in application code, not separate tables.

## Full Prisma schema

Build exactly this schema (this supersedes any earlier draft — it includes member auth + profile pictures + lifetime accounts):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Platform layer ─────────────────────────────────────────

model Superadmin {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())

  auditLogs AuditLog[]
}

model SaasPlan {
  id                  String   @id @default(uuid())
  name                String
  price               Decimal
  currency            String   @default("IDR")
  billingInterval     String   // "monthly" | "annual"
  maxMembers          Int
  maxStaff            Int
  maxWhatsappPerMonth Int
  customBranding      Boolean  @default(false)
  isActive            Boolean  @default(true)
  createdAt           DateTime @default(now())

  gyms             Gym[]
  platformPayments PlatformPayment[]
}

enum SubscriptionStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  SUSPENDED
  CANCELLED
}

model Gym {
  id                 String             @id @default(uuid())
  saasPlanId         String
  saasPlan           SaasPlan           @relation(fields: [saasPlanId], references: [id])
  name               String
  slug               String             @unique
  timezone           String             @default("Asia/Jakarta")
  subscriptionStatus SubscriptionStatus @default(TRIALING)
  nextBillingDate    DateTime?
  isLifetime         Boolean            @default(false) // true = never billed by subscription cron (e.g. founding/investor deals)
  settings           Json               @default("{}")
  createdAt          DateTime           @default(now())

  staff            StaffUser[]
  members          Member[]
  plans            MembershipPlan[]
  platformPayments PlatformPayment[]
  whatsappConfig   WhatsappSenderConfig?
  auditLogs        AuditLog[]
  checkins         CheckIn[]
  payments         Payment[]
  notifications    NotificationLog[]

  @@index([subscriptionStatus])
}

model PlatformPayment {
  id                String        @id @default(uuid())
  gymId             String
  gym               Gym           @relation(fields: [gymId], references: [id])
  saasPlanId        String
  saasPlan          SaasPlan      @relation(fields: [saasPlanId], references: [id])
  provider          String // "xendit" | "midtrans"
  externalInvoiceId String?       @unique
  amount            Decimal
  status            PaymentStatus @default(PENDING)
  createdAt         DateTime      @default(now())
  paidAt            DateTime?

  @@index([gymId])
}

model WhatsappSenderConfig {
  id              String  @id @default(uuid())
  gymId           String  @unique
  gym             Gym     @relation(fields: [gymId], references: [id])
  gatewayProvider String // "fonnte" | "wablas"
  senderNumber    String
  apiKeyEncrypted String // AES-256-GCM encrypted at application layer — never store plain
  isActive        Boolean @default(true)
}

// ─── Tenant layer ───────────────────────────────────────────

enum Role {
  OWNER
  STAFF
}

model StaffUser {
  id           String   @id @default(uuid())
  gymId        String
  gym          Gym      @relation(fields: [gymId], references: [id])
  name         String
  email        String   @unique
  phone        String?  // used for platform WhatsApp notifications (billing reminders)
  passwordHash String
  role         Role     @default(STAFF)
  createdAt    DateTime @default(now())

  checkins CheckIn[]

  @@index([gymId])
}

model MembershipPlan {
  id           String   @id @default(uuid())
  gymId        String
  gym          Gym      @relation(fields: [gymId], references: [id])
  name         String
  durationDays Int
  price        Decimal
  currency     String   @default("IDR")
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())

  members  Member[]
  payments Payment[]

  @@index([gymId])
}

enum MemberStatus {
  PENDING_PAYMENT
  ACTIVE
  EXPIRED
  FROZEN
  CANCELLED
}

model Member {
  id                  String         @id @default(uuid())
  gymId               String
  gym                 Gym            @relation(fields: [gymId], references: [id])
  planId              String
  plan                MembershipPlan @relation(fields: [planId], references: [id])
  fullName            String
  phoneWhatsapp       String
  phoneWhatsappLookup String         // HMAC blind-index of normalized phone — for exact-match lookup once phone is encrypted
  email               String         @unique // login identifier
  passwordHash        String?        // nullable until first-time activation is completed
  photoUrl            String?        // Vercel Blob URL (private access, signed at render time)
  qrSecret            String         @default(uuid())
  status              MemberStatus   @default(PENDING_PAYMENT)
  membershipExpiry    DateTime?
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  checkins      CheckIn[]
  payments      Payment[]
  notifications NotificationLog[]
  magicLinks    MagicLink[]

  @@index([gymId, status])
  @@index([membershipExpiry])
  @@index([phoneWhatsappLookup])
}

enum CheckInResult {
  SUCCESS
  DUPLICATE
  EXPIRED
  FROZEN
  INVALID
}

model CheckIn {
  id          String        @id @default(uuid())
  gymId       String
  gym         Gym           @relation(fields: [gymId], references: [id])
  memberId    String
  member      Member        @relation(fields: [memberId], references: [id])
  staffUserId String?
  staffUser   StaffUser?    @relation(fields: [staffUserId], references: [id])
  checkedInAt DateTime      @default(now())
  result      CheckInResult
  deviceLabel String?

  @@index([gymId, checkedInAt])
  @@index([memberId, checkedInAt])
}

enum PaymentProvider {
  XENDIT
  MIDTRANS
  CASH
}

enum PaymentStatus {
  PENDING
  PAID
  EXPIRED
  FAILED
}

model Payment {
  id                String          @id @default(uuid())
  gymId             String
  gym               Gym             @relation(fields: [gymId], references: [id])
  memberId          String
  member            Member          @relation(fields: [memberId], references: [id])
  planId            String
  plan              MembershipPlan  @relation(fields: [planId], references: [id])
  provider          PaymentProvider
  externalInvoiceId String?         @unique
  amount            Decimal
  currency          String          @default("IDR")
  status            PaymentStatus   @default(PENDING)
  createdAt         DateTime        @default(now())
  paidAt            DateTime?

  @@index([gymId])
}

model NotificationLog {
  id       String   @id @default(uuid())
  gymId    String
  gym      Gym      @relation(fields: [gymId], references: [id])
  memberId String
  member   Member   @relation(fields: [memberId], references: [id])
  type     String
  channel  String   @default("whatsapp")
  status   String
  sentAt   DateTime @default(now())

  @@index([gymId])
}

model MagicLink {
  id        String    @id @default(uuid())
  memberId  String
  member    Member    @relation(fields: [memberId], references: [id])
  tokenHash String    @unique
  purpose   String    @default("activate") // "activate" (set password/photo) | "qr_fallback" (view QR without login)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
}

model AuditLog {
  id           String     @id @default(uuid())
  superadminId String
  superadmin   Superadmin @relation(fields: [superadminId], references: [id])
  gymId        String?
  gym          Gym?       @relation(fields: [gymId], references: [id])
  action       String
  metadata     Json       @default("{}")
  createdAt    DateTime   @default(now())
}
```

## Auth: three session kinds

```ts
type SessionPayload =
  | { kind: "staff"; staffUserId: string; gymId: string; role: "OWNER" | "STAFF" }
  | { kind: "superadmin"; superadminId: string }
  | { kind: "member"; memberId: string; gymId: string };
```

JWT in an httpOnly, secure, sameSite=lax cookie. 7-day expiry.

## Tenant isolation (non-negotiable, highest-priority correctness requirement)

- Every tenant-scoped query MUST filter by `gymId` taken from the verified session — never from a client-supplied value.
- Build `requireTenantSession(slug)` as the single choke point every gym-scoped page/route calls: re-verifies the session's `gymId` against the `slug` in the URL, checks `subscriptionStatus` isn't `SUSPENDED`/`CANCELLED`.
- Build `requireSuperadminSession()` similarly for `/superadmin/*` routes.
- Write `prisma/RLS.md` documenting Postgres Row-Level Security policies as a follow-up hardening step (policies keyed to `gym_id`, using `current_setting('app.current_gym_id')`) — implement the SQL file but note it's optional to apply before go-live, required before onboarding a second real paying tenant.

## Encryption requirements

- `phoneWhatsapp` and `email` on `Member`: encrypt at rest with AES-256-GCM using a key from `ENCRYPTION_KEY` env var. Store as `v1:<base64ciphertext>` to support future key rotation.
- `phoneWhatsappLookup`: HMAC-SHA256 of the normalized phone number (E.164-ish, digits only) using a separate static key (`LOOKUP_HMAC_KEY` env var) — this is what queries filter on, since the encrypted column can't do exact-match lookups.
- `WhatsappSenderConfig.apiKeyEncrypted`: same AES-256-GCM encryption — this is a credential, treat it at least as seriously as PII.
- Never log decrypted values. Mask phone/email in any list view (e.g. `+62•••••1234`) — only decrypt when rendering a single member's own detail view.
- Build `src/lib/crypto.ts` exposing `encrypt(plain: string): string`, `decrypt(ciphertext: string): string`, and `hmacLookup(value: string): string`.

## QR check-in

- `src/lib/qr.ts`: HMAC-signed token containing `{ gymId, memberId, issuedAt }`, signed with `memberQrSecret` + a server-wide `QR_SERVER_SECRET`. Verify by recomputing the HMAC against the member's current `qrSecret` — rotating `qrSecret` instantly invalidates all previously issued QR codes for that member.
- `/g/[slug]/checkin`: staff-only page, opens device camera via `html5-qrcode`, posts scanned token to `/api/checkin`.
- `/api/checkin`: validates session is staff, validates gym not suspended, decodes token, rejects if `gymId` in token doesn't match session's `gymId` (cross-tenant QR), looks up member, verifies signature against member's `qrSecret`, checks `status`/`membershipExpiry`, blocks a second `SUCCESS` same calendar day (duplicate policy), logs every attempt (including rejections) to `CheckIn`.
- Result screen: full-screen color-coded overlay — green SUCCESS, amber DUPLICATE, red EXPIRED/FROZEN/INVALID/GYM_SUSPENDED.

## Member accounts (password-based, not magic-link-only)

- Owner/staff adds a member via `/g/[slug]/members` → creates `Member` with `passwordHash: null`, `status: PENDING_PAYMENT`.
- System creates a `MagicLink` with `purpose: "activate"`, sends WhatsApp with an `/activate/[token]` link.
- `/activate/[token]`: member sets password AND can upload a profile picture in the same step. On submit: hash password into `passwordHash`, upload photo to Vercel Blob (private access) if provided, mark `MagicLink.usedAt`.
- After activation: member logs in normally at `/g/[slug]/member-login` with email + password → session `{ kind: "member", memberId, gymId }`.
- `/my-qr` (member's own QR view) accepts EITHER a valid member session OR a valid unexpired `MagicLink` with `purpose: "qr_fallback"` — so a forgotten password doesn't lock someone out at the gym door. Owner/staff can trigger a fresh fallback link resend from the member's detail view.
- Profile picture upload: resize client-side to 512×512 before upload (canvas resize), cap at 2MB, validate image mime type, upload via `@vercel/blob` `put()` with `access: 'private'`, store the resulting URL in `photoUrl`.

## Payments — two invoice flows through one webhook

- `src/lib/xendit.ts`: `createXenditInvoice()`, `verifyXenditCallback(headerToken)` — checks the `x-callback-token` header against `XENDIT_CALLBACK_TOKEN` env var.
- Member billing: creating a `Member` also creates a `Payment` (status `PENDING`) and a Xendit invoice, `externalInvoiceId` stored, invoice URL sent via WhatsApp alongside the activation link.
- Platform billing: daily cron creates `PlatformPayment` + Xendit invoice for any `Gym` whose `nextBillingDate` is due AND `isLifetime` is `false`.
- `/api/webhooks/xendit`: single endpoint handles both. Verify callback token first (401 if invalid). Look up `event.external_id` against `Payment.id` first, then `PlatformPayment.id`. On `PAID`: extend `Member.membershipExpiry` (member payment) or extend `Gym.nextBillingDate` + set `subscriptionStatus: ACTIVE` (platform payment). On `EXPIRED`: mark record `EXPIRED`, set `Gym.subscriptionStatus: PAST_DUE` for platform payments. **Must be idempotent** — re-processing the same webhook event twice must not double-extend anything (check current status before mutating).
- Annual billing: `SaasPlan.billingInterval` is `"monthly"` or `"annual"` — cron adds 30 or 365 days accordingly on successful platform payment. Both intervals can exist as separate `SaasPlan` rows for the same tier (e.g. "Starter Monthly" Rp 300,000 and "Starter Annual" Rp 3,000,000).

## Superadmin

- `/superadmin/login`, `/superadmin/gyms` (list all tenants with MRR/member count, create new gym tenant, suspend/reactivate).
- Creating a gym tenant: superadmin form takes gym name, slug, owner name/email/phone/temp-password, `saasPlanId`, and an `isLifetime` checkbox. Creates `Gym` + first `StaffUser` (role `OWNER`) in one transaction. Sends WhatsApp welcome to the owner.
- Every superadmin mutation (suspend, reactivate, create) writes an `AuditLog` row.
- Exclude `isLifetime` gyms from MRR calculation on the dashboard — track their one-time payment as a separate figure, don't let it inflate the recurring-revenue number.

## WhatsApp

- `src/lib/whatsapp.ts`: `sendGymWhatsapp(gymId, {to, message})` looks up that gym's `WhatsappSenderConfig`, decrypts the API key, sends via the configured gateway (Fonnte or Wablas — implement the real Fonnte REST call: `POST https://api.fonnte.com/send` with `Authorization` header = decrypted key). `sendPlatformWhatsapp({to, message})` uses `PLATFORM_WHATSAPP_API_KEY` env var for owner-facing platform notifications (billing reminders, payment failures).
- Log every send attempt to `NotificationLog`.

## Cron jobs (`vercel.json`)

- `/api/cron/subscriptions` (daily): create platform renewal invoices for gyms due today (skip `isLifetime`), sweep `PAST_DUE` gyms past a 3-day grace period into `SUSPENDED`.
- `/api/cron/member-reminders` (daily): WhatsApp reminder 3 days before `membershipExpiry`, sweep expired members into `EXPIRED` status with a WhatsApp notice.
- Both routes require `Authorization: Bearer ${CRON_SECRET}`.

## Pages to build

- `/` — simple landing with links to superadmin and gym login
- `/superadmin/login`, `/superadmin/gyms`
- `/g/[slug]/login` (staff), `/g/[slug]/member-login` (member)
- `/g/[slug]/dashboard` — active members, today's check-ins, month revenue, expiring-soon list (staff/owner only)
- `/g/[slug]/checkin` — camera scanner (staff/owner only)
- `/g/[slug]/members` — list + add member form (staff/owner only; owner-only fields like plan limits shown per role)
- `/g/[slug]/billing` — platform subscription status + invoice history (owner only — staff should get 403)
- `/activate/[token]` — member sets password + uploads photo
- `/my-qr` — member's own QR (requires member session OR valid `qr_fallback` magic link)

## Validation

Use zod schemas for every API route's request body — reject malformed input before it touches Prisma.

## e2e tests (Playwright)

Set up against a seeded test database. Cover:

1. **Superadmin flow**: login → create a gym tenant → gym appears in list → suspend it → staff login for that gym is blocked with a clear "suspended" message → reactivate → login works again.
2. **Owner onboarding a member**: owner login → add member → member receives activation link (assert `MagicLink` row created, mock/stub the WhatsApp send) → visit `/activate/[token]` → set password + upload a test image → member can now log in at `/g/[slug]/member-login`.
3. **Check-in happy path**: activated + paid (simulate a `PAID` webhook call) member's QR token → staff scans it at `/g/[slug]/checkin` → SUCCESS result shown → `CheckIn` row created with `result: SUCCESS`.
4. **Check-in rejections**: (a) same member scanned twice same day → DUPLICATE; (b) member with `status: EXPIRED` → EXPIRED result; (c) a QR token built with a different `gymId` → INVALID (cross-tenant rejection) — this test matters most, it's the tenant-isolation regression test.
5. **Payment webhook idempotency**: fire the same `PAID` webhook event twice for one `Payment` → `membershipExpiry` only extends once, not twice.
6. **Suspended gym blocks check-in**: gym with `subscriptionStatus: SUSPENDED` → `/api/checkin` returns `GYM_SUSPENDED` even with an otherwise-valid QR.
7. **Member fallback QR access**: member "forgets password" scenario → owner triggers a fresh `qr_fallback` magic link → member can view `/my-qr` via that link without a session.

## Explicitly out of scope tonight

- "Who's in the gym" live occupancy (needs a check-out event or session-timeout design — not decided yet)
- Leaderboard / gamification
- Self-serve gym signup (superadmin manually provisions tenants for now)
- Midtrans (Xendit only for v1)
- Real Fonnte/Wablas account wiring can be stubbed with a clearly logged no-op if credentials aren't available yet — structure the code so swapping in a real API call later is a one-function change

## Env vars needed

```
DATABASE_URL=
JWT_SECRET=
QR_SERVER_SECRET=
ENCRYPTION_KEY=
LOOKUP_HMAC_KEY=
XENDIT_SECRET_KEY=
XENDIT_CALLBACK_TOKEN=
PLATFORM_WHATSAPP_PROVIDER=fonnte
PLATFORM_WHATSAPP_API_KEY=
BLOB_READ_WRITE_TOKEN=
NEXT_PUBLIC_APP_URL=
CRON_SECRET=
```

## Seed script

Create: two `SaasPlan` rows for Starter (monthly Rp 300,000 + annual Rp 3,000,000, same limits: 100 members / 3 staff / 500 WhatsApp msgs), one `Superadmin`, one demo `Gym` (slug `demo`) with `isLifetime: true` set on a second seeded gym to exercise that path, one `StaffUser` (OWNER) per gym, two `MembershipPlan` rows (Monthly/Annual) for the demo gym. Print all created IDs and login credentials to console.
