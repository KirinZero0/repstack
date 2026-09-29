# Planned: gym profile page + classes

Two features requested but not yet built. Written as a spec for whoever (or whichever session)
picks these up next — follow the project's existing conventions (tenant isolation via
`requireTenantSession`/`tenantDb`, RLS grants in `prisma/rls.sql`, zod schemas in
`src/lib/validation/tenant.ts`, migrations per `prisma/MIGRATIONS.md`, e2e coverage per feature).

---

## 1. Gym profile page + photos

A public page for each gym, and a way for the owner to upload photos of the gym.

### URL

`/[slug]` itself is currently empty (no `page.tsx` at `src/app/[slug]/page.tsx` — every existing
route is one level deeper, like `/[slug]/login`). Use that slot: `repstack.com/mygym` is the gym's
public profile. No new reserved word needed, no route collision.

### Schema

Add to `Gym` (migration):

```prisma
description String?
address     String?
photoUrls   String[]   @default([])   // Vercel Blob public URLs, display order = array order
```

Cap `photoUrls` at some sane number server-side (e.g. 8) — don't rely on the client for that.

### Photo upload

Gym photos are **public** (unlike `Member.photoUrl`, which is a private blob). Use
`put(path, file, { access: "public" })`, called server-side in the API route — same pattern as
`src/app/api/activate/[token]/route.ts` already uses for member photos, just `access: "public"`
instead of `"private"`.

Resize client-side before upload, like `src/lib/resizeImage.ts` (`resizeImageTo512`) does for
member avatars — but a gym photo shouldn't be force-cropped to a square. Write a sibling helper,
e.g. `resizeImageToMaxWidth(file, 1600)`, that keeps the aspect ratio and just caps the longest
side, so gallery/hero photos don't come out square-cropped. Cap upload size (e.g. 5MB) and MIME
type (jpeg/png/webp), same validation shape as the existing activation-photo upload.

### API routes (owner-only, under `src/app/api/[slug]/photos/`)

- `POST` — multipart upload, one photo. Checks the cap, uploads, appends the URL to
  `Gym.photoUrls`, returns the new URL. Use `requireTenantSession(slug)` + `session.role === "OWNER"`.
- A remove route (`POST .../photos/remove` with `{ url }`, or `DELETE` with a body) — removes that
  URL from the array and calls Blob's `del(url)` so storage doesn't leak.

Add a "Gym photos" card to `src/app/[slug]/settings/page.tsx` (owner-only, matches the existing
`BankDetailsForm`/`GymDetailsForm` card pattern in `src/components/SettingsForms.tsx`): a grid of
current photos each with a remove button, plus an upload input. Also add `description` and
`address` fields to the existing `GymDetailsForm` (or a new card) and thread them through
`gymSettingsSchema`/`POST /api/[slug]/settings` the same way `name`/`timezone` already are.

### The public page itself

`src/app/[slug]/page.tsx` (new): look up the gym by slug with the **owner** `prisma` client (no
session — this page is public). `notFound()` if the slug doesn't exist. Show name, description,
address, a photo gallery (or a placeholder state if none uploaded), and:

- A "Join" call-to-action to `/[slug]/join`, but only when `JOIN_PAGE_ENABLED` (currently `false`
  in `src/lib/memberSignup.ts`, see `PLANNED_FEATURES` note below — check its value, it's likely
  been turned back on by then) **and** `gymAcceptsSignups(gym.settings)`.
- A "Log in" link to `/[slug]/login` for existing staff/members.
- Don't reveal anything sensitive here — no member data, no financials. It's a marketing page.

A suspended or cancelled gym can still show its profile (nothing sensitive on it), but hide the
join CTA — cross-check `gym.subscriptionStatus`.

### Tests

New e2e spec, roughly:
- Public page renders name/description/photos for an existing gym, 404s for an unknown slug.
- Owner can upload a photo (mock/skip actual Blob call the way other tests do when
  `BLOB_READ_WRITE_TOKEN` isn't set locally — see how `e2e/02-member-onboarding.spec.ts` handles
  the same situation for member photos), remove one, and hits the cap.
- Staff (non-owner) can't upload or remove photos — 403.
- Another gym's owner can't touch this gym's photos — tenant isolation.

---

## 2. Classes (schedule, price, registration, payment)

Bigger feature. Gym sets up classes with a price; members register and pay (manual or online,
reusing the per-gym payments toggle from `src/lib/gateway.ts`'s `memberPaymentsEnabled`).

### Schema (new models — add to `prisma/schema.prisma`, then a migration)

```prisma
model GymClass {
  id          String   @id @default(uuid())
  gymId       String
  gym         Gym      @relation(fields: [gymId], references: [id])
  name        String
  description String?
  instructor  String?           // free text for v1, no separate Instructor model yet
  price       Decimal
  currency    String   @default("IDR")
  capacity    Int?              // null = unlimited
  durationMinutes Int
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  sessions ClassSession[]

  @@index([gymId])
}

enum ClassSessionStatus {
  SCHEDULED
  CANCELLED
  COMPLETED
}

model ClassSession {
  id        String              @id @default(uuid())
  gymId     String
  gym       Gym                 @relation(fields: [gymId], references: [id])
  classId   String
  class     GymClass            @relation(fields: [classId], references: [id])
  startsAt  DateTime
  capacity  Int?                // overrides GymClass.capacity for this session if set
  status    ClassSessionStatus  @default(SCHEDULED)
  createdAt DateTime            @default(now())

  registrations ClassRegistration[]

  @@index([gymId, startsAt])
}

enum ClassRegistrationStatus {
  PENDING_PAYMENT
  CONFIRMED
  CANCELLED
}

model ClassRegistration {
  id        String                   @id @default(uuid())
  gymId     String
  gym       Gym                      @relation(fields: [gymId], references: [id])
  sessionId String
  session   ClassSession             @relation(fields: [sessionId], references: [id])
  memberId  String
  member    Member                   @relation(fields: [memberId], references: [id])
  status    ClassRegistrationStatus  @default(PENDING_PAYMENT)
  createdAt DateTime                 @default(now())

  payment ClassPayment?

  @@index([gymId])
  @@unique([sessionId, memberId]) // one registration per member per session
}

model ClassPayment {
  id                String          @id @default(uuid())
  gymId             String
  gym               Gym             @relation(fields: [gymId], references: [id])
  registrationId    String          @unique
  registration      ClassRegistration @relation(fields: [registrationId], references: [id])
  provider          PaymentProvider // reuse the existing enum (XENDIT | MIDTRANS | CASH)
  externalInvoiceId String?         @unique
  invoiceUrl        String?
  amount            Decimal
  currency          String          @default("IDR")
  status            PaymentStatus   // reuse the existing enum (PENDING | PAID | EXPIRED | FAILED)
  createdAt         DateTime        @default(now())
  paidAt            DateTime?
  recordedById      String?         // staff who recorded a manual (CASH) payment
  recordedBy        StaffUser?      @relation(fields: [recordedById], references: [id])

  @@index([gymId])
}
```

Why a separate `ClassPayment` instead of reusing `Payment`: `Payment.planId` is required (tied to
`MembershipPlan`), and it's already load-bearing for the existing membership + webhook code. Don't
touch that table's shape — mirror it instead. Same fields, same idempotency approach, no risk to
existing flows.

Why sessions are individual rows, not a recurrence rule: simplest to build and reason about. If the
owner wants "Yoga every Monday for 8 weeks," the UI can offer a "repeat weekly, N times" helper that
just creates N `ClassSession` rows — no recurrence engine, no edge cases around "what if one
occurrence in the series gets edited."

Registration capacity: before creating a `PENDING_PAYMENT` registration, count existing
`CONFIRMED` (and maybe `PENDING_PAYMENT` too, to prevent overselling while someone's mid-payment)
registrations for that session against its effective capacity (`session.capacity ??
class.capacity`); refuse if full.

### RLS

`GymClass`, `ClassSession`, `ClassRegistration`, `ClassPayment` all have `gymId` and are gym-scoped
tenant data — add each to `prisma/rls.sql` (policy + grant), `prisma/check-rls.ts`'s
`TENANT_TABLES`, and the "sees only its own rows" checks in `e2e/15-row-level-security.spec.ts`.
Run `npm run db:rls` after the migration. `prisma/RLS.md` has the full checklist under
"Adding a table."

### Payment flow

Reuses `src/lib/gateway.ts` exactly as membership payments do:

- **Manual**: owner/staff marks a registration `CONFIRMED` and records a `ClassPayment` with
  `provider: "CASH"`, `status: "PAID"`, `recordedById` set — same shape as the existing manual
  member-payment flow (`src/app/api/[slug]/members/[memberId]/payments/route.ts`).
- **Online**: only offered when `memberPaymentsEnabled(gym.settings)` is true (the toggle from
  `src/app/g/[slug]/settings` — er, `src/app/[slug]/settings` now). Create the `ClassRegistration`
  as `PENDING_PAYMENT`, create a `ClassPayment` row, then `createInvoice()` with
  `externalId: classPayment.id` (or the registration id — pick one and be consistent, `payment.id`
  matches how `src/app/api/pay/route.ts` does it for memberships).
- **Webhook**: `src/lib/payments.ts`'s `processPaymentEvent()` currently checks `Payment`, then
  `PlatformPayment`, then `GymSignup`, then `MemberSignup` for the `external_id`. Add a
  `ClassPayment` lookup to that chain — same idempotent pattern (`if (payment.status !== "PENDING")
  return`), and on `PAID` also flip the linked `ClassRegistration` to `CONFIRMED` (checking capacity
  again isn't needed here — it was checked at registration time, and payment confirming late
  doesn't un-reserve the spot).

### Pages

- **Owner**, `/[slug]/classes`: create/edit/deactivate class types; schedule/cancel sessions
  (including the "repeat weekly" helper); see the roster (registrations) per session; record a
  manual payment or mark attendance is a fine v2, not required for v1. Add "Classes" to
  `src/components/GymNav.tsx`'s `ITEMS` (owner-only, like Staff/Plans/Finance).
- **Member**, `/my/classes`: browse upcoming sessions (grouped by class or by date — either is
  fine), register (mirrors `src/app/my/pay/page.tsx` + `PayButton` for the online-pay case; a
  manual-pay registration just shows "pending, pay at the gym" until staff confirm it), see their
  own upcoming/past registrations, cancel their own registration before some cutoff (e.g. up to
  the session's `startsAt`).
- **Public** (optional, nice-to-have): list active class types (no prices/registration) on the new
  `/[slug]` profile page from feature 1, as a teaser. Not required for v1.

### WhatsApp

Send a confirmation via `sendGymWhatsapp` when a registration is confirmed (paid, whether manual or
online) — same pattern as `member_welcome`/`payment_receipt` elsewhere. A reminder before the class
starts is a nice v2 (could piggyback on the existing `/api/cron/member-reminders` cron or get its
own), skip it for v1.

### Validation

Add to `src/lib/validation/tenant.ts`: `createClassSchema`, `updateClassSchema`,
`createClassSessionSchema`, `registerForClassSchema` — follow the existing plan schemas
(`createPlanSchema`/`updatePlanSchema`) as the template.

### Tests

New e2e spec(s), covering at minimum:
- Owner creates a class and a session; member registers (manual path) and staff confirms it.
- Online registration + webhook confirms it, idempotently (fire the same event twice).
- Session at capacity refuses a new registration.
- A member can't register twice for the same session (the `@@unique([sessionId, memberId])`).
- Tenant isolation: another gym's staff/member can't see or touch this gym's classes/sessions/
  registrations — this is the pattern every other feature's tests check, and it's the one that
  matters most.
- Member cancels their own registration; can't cancel someone else's.

---

## Notes for whoever picks this up

- Both features need a Prisma migration (`npx prisma migrate dev --create-only --name ...`), then
  `npm run db:rls` for feature 2's new tables. See `prisma/MIGRATIONS.md`.
- Check `JOIN_PAGE_ENABLED` in `src/lib/memberSignup.ts` before wiring the profile page's "Join"
  CTA — it may still be `false` (turned off pending a real business bank account for the platform's
  own subscription; each gym's own bank details for member payments are unaffected by that flag).
- Run the full suite (`npm run test:e2e`) and `npm run build` before committing — the project keeps
  a clean baseline (as of this writing: all green except two pre-existing failures in
  `e2e/17-billing.spec.ts` gated behind the platform-wide `PAYMENTS_ENABLED` env var, unrelated to
  either feature here).
