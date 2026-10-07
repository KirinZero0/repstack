# Gym profile page + classes

Both features this file used to spec are now built. This is the short map of where they live;
conventions are the project's usual ones (tenant isolation via `requireTenantSession`/`tenantDb`,
RLS in `prisma/rls.sql`, zod in `src/lib/validation/tenant.ts`, e2e per feature).

Migration: `prisma/migrations/20260929014228_gym_profile_and_classes`. Run `npm run db:rls` after
deploying it — four new tenant tables need their policies and grants.

## 1. Gym profile page + photos

- **Public page** `src/app/[slug]/page.tsx` — `repstack.com/<slug>`. Name, description, address,
  photo gallery, active class types (no prices), a Log in link, and a Join call-to-action only when
  `JOIN_PAGE_ENABLED` and the gym accepts sign-ups. Suspended/cancelled gyms keep the page, minus the
  join button. Owner client, no session, no member data or money on it.
- **Schema** `Gym.description`, `Gym.address`, `Gym.photoUrls String[]` (public Blob URLs, display
  order = array order, capped at `MAX_GYM_PHOTOS` = 8 server-side).
- **Settings** (`/[slug]/settings`, owner only): "Public page" card (`GymProfileForm` → the existing
  `POST /api/[slug]/settings`, fields `description`/`address`) and "Gym photos" card
  (`src/components/GymPhotosManager.tsx`).
- **Photo API** `POST /api/[slug]/photos` (multipart, one photo, jpeg/png/webp, 5MB, cap) and
  `POST /api/[slug]/photos/remove` (`{ url }`, only a URL the gym holds, deletes the blob). Owner only.
- **Blob** `src/lib/blob.ts`: `putPublicImage` / `deleteBlob`. With no `BLOB_READ_WRITE_TOKEN`
  outside production, uploads are faked (`https://mock-blob.local/...`) so the flow runs locally and
  in e2e — same idea as `WHATSAPP_MOCK`/`PAYMENTS_MOCK`. In production a missing token is a 502 to the owner.
- **Client resize** `resizeImageToMaxWidth(file, 1600)` in `src/lib/resizeImage.ts` keeps the aspect ratio.
- **Tests** `e2e/22-gym-profile.spec.ts`.

## 2. Classes

- **Schema** `GymClass` (type: name, instructor, price, capacity, duration), `ClassSession` (one
  row per occurrence; "repeat weekly N times" just creates N rows), `ClassRegistration` (one per
  member per session), `ClassPayment` (mirrors `Payment` rather than reusing it; `Payment.planId` is
  membership-specific). All four are RLS tenant tables.
- **Owner/staff page** `/[slug]/classes` (`ClassesManager.tsx`). Owner: create/edit/hide classes,
  schedule sessions (times entered in the gym's timezone, see `zonedTimeToUtc` in `src/lib/date.ts`),
  cancel a session. Owner and staff: see each session's roster and record a front-desk payment.
  "Classes" is in `GymNav` for both roles.
- **Member page** `/my/classes`: upcoming sessions by day with seats left, book, cancel own
  booking (any time before it starts), past/cancelled history.
- **Staff API** (owner only unless noted): `POST /api/[slug]/classes`,
  `PATCH /api/[slug]/classes/[classId]`, `POST /api/[slug]/classes/[classId]/sessions`
  (`startsAt`, `repeatWeeks`, `capacity`), `PATCH /api/[slug]/class-sessions/[sessionId]`
  (`{ action: "cancel" }`), `POST /api/[slug]/class-registrations/[id]/confirm` (owner or staff,
  `{ amount, note }` → CASH `ClassPayment`, registration CONFIRMED, WhatsApp).
- **Member API**: `POST /api/my/classes/register` (`{ sessionId }`), `POST /api/my/classes/[id]/cancel`.
- **Payment flow** (`src/lib/gateway.ts`):
  - price 0 → CONFIRMED at once, no payment row.
  - `memberPaymentsAvailable(gym.settings)` (gym opted in **and** provider ready or mock mode) →
    PENDING registration + `ClassPayment` + invoice (`externalId = classPayment.id`). The seat is held
    while the invoice is open; asking again resumes the same invoice.
  - otherwise → PENDING registration, no payment; staff confirms at the desk.
  - Webhook: `processPaymentEvent` in `src/lib/payments.ts` looks up `ClassPayment` after the other
    kinds. PAID → registration CONFIRMED + WhatsApp, idempotent. EXPIRED → payment EXPIRED,
    registration CANCELLED (seat freed; booking again reuses the row with a fresh invoice).
  - Capacity: `session.capacity ?? class.capacity`; PENDING and CONFIRMED both hold a seat; checked
    inside the registration transaction.
  - Cancelling a session cancels its registrations, expires pending invoices, keeps PAID payments on
    record (refunds are the gym's call) and messages everyone booked.
- **WhatsApp** types: `class_confirmation`, `class_cancelled` (via `sendGymWhatsapp`, `src/lib/classes.ts`).
- **Dev mock checkout**: `/api/dev/mock-pay` and the `/my` mock checkout box handle class payments too.
- **Tests** `e2e/23-classes.spec.ts`.

## Not built (deliberately)

- Instructor accounts. (Attendance marking, class reminders and class revenue on the Finance page
  have since been built on top of the tables above; reminders run once a day for the next day's
  classes so they fit a daily-cron hosting plan.)

# Roadmap

Planned for later updates. None of this is built, and none of it is needed for a first pilot.
Nothing here changes how the current version works; the notes say where each piece would touch the code.

## More staff roles

- Today `Role` is `OWNER | STAFF` and permissions are `role` checks spread across pages and API routes
  (the nav hides pages with `ownerOnly` in `GymNav`). New roles (manager, trainer, front office, sales)
  mean new enum values plus one central permissions list so the checks stop being scattered.
- Owner-only today: staff, plans, finance, billing, settings. A manager role would sit between the two.
- Personal trainers are the common ask for small gyms: PT sessions per client, not just a class
  instructor name.

## Multi-branch

- Everything is isolated by a single `gymId` from the session, and row-level security (`prisma/rls.sql`)
  is keyed on it. A chain needs an organisation above gyms, with an owner who can see several branches.
- That touches the session shape, `requireTenantSession`, the RLS policies and the cross-tenant tests.
  Do it carefully and re-run `04-checkin-rejections` (the tenant-isolation regression test) first.
- Billing is per gym today; decide whether a chain pays per branch or per organisation.

## Mobile apps

- Sessions are an httpOnly JWT cookie, which suits the browser. A native app needs token-based auth
  against the same API. The member QR and check-in endpoints can be reused as they are.
- Custom-branded apps per gym (a competitor offers this) is a separate, larger step.

## Card maker and titles

- Print a member card with their QR, photo, name and a title (for example a membership tier).
- The member QR has no expiry: `issuedAt` is only part of the signed data and is never checked. A printed
  card keeps working until that member's `qrSecret` is rotated. There is no rotate button yet; add one
  before cards ship, so a lost card can be killed.
- Staff and owners can already open a member's QR (`GET /api/[slug]/members/[memberId]/qr`, shown on the
  member page), which is the data a card needs.

## Face recognition (door check-in)

- Treat as its own project, decided separately from the rest of the roadmap.
- **Code provenance:** build it from public libraries or papers, written without reference to any
  former or current employer's code, and keep a short note of each source and its license. Check the
  license of every pretrained model; several popular ones are research-only and not allowed in a paid product.
- **Personal data:** a face template is biometric data. Under Indonesia's personal data protection law
  (UU PDP) it is treated as specific personal data, so expect to need explicit per-member consent, a
  stated purpose and retention period, encryption at rest, and a delete path (the existing "erase my
  data" flow is the base). Confirm the exact requirements before collecting any.
- **Security:** a printed photo can fool a basic matcher, so a door needs liveness detection. Keep the QR
  as the fallback, since false rejects at the door are a daily complaint and false accepts let someone
  in on another member's membership.
- **Hardware** (turnstiles, readers) is per-device integration and support work; treat it as a later paid
  add-on.
