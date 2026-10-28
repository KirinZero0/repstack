# Gym profile page + classes

Both features this file used to spec are now built. This is the short map of where they live;
conventions are the project's usual ones (tenant isolation via `requireTenantSession`/`tenantDb`,
RLS in `prisma/rls.sql`, zod in `src/lib/validation/tenant.ts`, e2e per feature).

Migration: `prisma/migrations/20260929014228_gym_profile_and_classes`. Run `npm run db:rls` after
deploying it — four new tenant tables need their policies and grants.

## 1. Gym profile page + photos

- **Public page** `src/app/[slug]/page.tsx` — `liftmora.com/<slug>`. Name, description, address,
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

## 3. Guest class tickets (non-members)

A non-member asks for one class session, staff approves, and the guest gets a one-time QR ticket
over WhatsApp. Scanning it with the normal check-in scanner marks them attended.

- **Schema** `GuestPass` (status `PENDING_REVIEW → APPROVED → ATTENDED`, or `REJECTED`; phone
  encrypted + HMAC blind index; `ticketSecret` signs the QR). `NotificationLog.memberId` is now
  nullable so messages to guests can be logged. Migration `20261009000000_guest_class_tickets`;
  run `npm run db:rls` after deploying it (new tenant table).
- **Public** `/[slug]/guest-pass` (pick an upcoming session, name + WhatsApp number) →
  `POST /api/[slug]/guest-passes`. IP/gym throttled, one request per phone per session, session
  must belong to the gym. Linked from the gym's public page.
- **Staff** `/[slug]/members/guests` (owner and staff) → `POST /api/[slug]/guest-passes/[passId]`
  `{ action: "approve" | "reject" | "resend" }`. Approve checks capacity (approved guests hold a
  seat, same as bookings), sends the ticket link (`guest_ticket`), and is compare-and-set so two
  staff can't both decide.
- **Ticket** `/ticket/[token]` shows the QR while the pass is approved and unused. The token is
  `ticket.<payload>.<hmac>` (`src/lib/qr.ts`), signed with the pass's `ticketSecret`.
- **Scan** `/api/checkin` routes `ticket.` tokens to the ticket handler: right gym, valid
  signature, approved, session scheduled, within 1h before start → end of class. `APPROVED →
  ATTENDED` is one atomic update, so a second scan (or two scanners) gets `DUPLICATE`. No
  `CheckIn` row — guests aren't members.
- **Not built:** guests are not charged online; the gym collects any fee itself. Tests: `e2e/35-guest-tickets.spec.ts`.

### Day passes (same ticket pipeline, no class)

A gym can sell a one-visit ticket to non-members. It never creates a `Member`. It lives with the
membership side of the app, not under classes.

- **Schema** `DayPassPlan` (name, price, `validityDays`; RLS tenant table). A `GuestPass` is for a class
  session **or** a day pass (`sessionId` nullable, `dayPassPlanId`; a DB check enforces exactly one).
  Migration `20261009010000_day_passes`; run `npm run db:rls` after deploying it.
- **Owner** manages day passes on `/[slug]/plans`, under the membership plans
  (`POST /api/[slug]/day-pass-plans`, `PATCH …/[planId]` for rename / reprice / validity / hide).
  Staff can't. **Validity** is the number of days a ticket works after staff approve it (default 30,
  1–730); leave it empty for a plan whose tickets never expire.
- **Visitor** finds it on the join page ("Just visiting?") and the gym's public page →
  `/[slug]/join/day-pass`: pick a plan, no date. One open request or unused ticket per phone and plan;
  after a ticket is used (or declined) they can ask again. Class spots stay on `/[slug]/guest-pass`.
- **Review** both kinds of guest request on `/[slug]/members/guests`, linked from Members (with a
  pending-count banner) and from Classes. Approve/reject/resend work the same for both.
- **Ticket** is single-use and works any day until `expiresAt` (set when staff approve:
  approval time + the plan's `validityDays`; none for a never-expiring plan). After that a scan says
  "Day pass has expired". Day passes have no capacity limit. Passes issued before this change keep
  their fixed `visitDate` and are still valid on that day only (migration
  `20261009040000_day_pass_validity` adds `validityDays` and `expiresAt`).
- **Revenue** `GuestPass.amount` snapshots the price when the guest requests (day pass plan price, or
  the class price; later price changes don't rewrite history). A guest ticket with a price counts as
  revenue when staff **approve** it, because approving is the moment they confirm the money arrived;
  declined or still-waiting requests don't count, scanned or not. It shows on Finance ("from day
  passes", the 12-month chart, by plan, recent payments as "(guest)") and in both CSV exports (type
  "Day pass", or "Class" for a paid class spot; the monthly report has a "Day pass revenue" column).

### Paying by bank transfer (guests and members)

Uses the gym's bank details from Settings (the same ones the join page shows); with none on file the
forms say "pay at the front desk". Proof screenshots are optional, 2MB, JPEG/PNG/WebP, stored as
private blobs, and only staff of the same gym can open them. Nothing is confirmed by the upload itself.

- **Guests (class spot or day pass):** the request form shows the price, the bank account and a proof
  upload (`POST /api/[slug]/guest-passes` now also accepts multipart). Free tickets ignore any upload.
  Staff open `/[slug]/members/guests`, see the amount and "View transfer proof"
  (`GET /api/[slug]/guest-passes/[passId]/proof`), check their bank, then press **Payment received —
  approve**; that sends the ticket and counts the revenue. Decline if the money never came.
- **Members (class booking):** an unpaid booking on `/my/classes` shows the bank account and a
  screenshot upload (`POST /api/my/classes/[registrationId]/proof`; own booking, unpaid, session not
  started, not already being paid online). The class roster shows "View transfer proof"
  (`GET /api/[slug]/class-registrations/[registrationId]/proof`); staff then use the existing
  **Record payment** to confirm, as before.
- Migration `20261009030000_transfer_proofs` (proof columns on `GuestPass` and `ClassRegistration`).

## 4. Fixing mistakes: deletes, voids and undo

The rule, followed everywhere: **anything that never touched money is deleted; anything that took
money is voided (kept on the books, out of revenue), never deleted.** Voids are owner-only. Every
delete is tenant-scoped (a gym can only reach its own rows), asks for confirmation in the UI, and
refuses with a clear message (409) when history would be lost.

| Data | Fix a mistake | Who |
| --- | --- | --- |
| Membership plan | Delete if no member/payment uses it, else hide | owner |
| Day-pass plan | Delete if no one has requested it, else hide (`DELETE /api/[slug]/day-pass-plans/[id]`) | owner |
| Class, class session | Delete if unused, else hide / cancel (existing) | owner |
| Class booking | Cancel / delete if unpaid (existing) | owner, staff |
| **Class payment** recorded by hand | **Undo payment** → voided, booking back to "waiting for payment" (`POST …/class-registrations/[id]/void`); online payments are refunded via the provider | owner |
| Membership payment recorded by hand | Void (existing) | owner |
| **Member** added by mistake | **Delete** if no payments, visits or bookings (`DELETE …/members/[id]`); otherwise cancel, or erase personal data (existing) | owner |
| **Check-in** (scan, manual, tapped twice) | **Remove** it (`DELETE …/checkins/[id]`); the member's daily check-in is free again | owner, staff |
| **Guest request / ticket** | **Delete** if unpaid, declined, or free (`DELETE …/guest-passes/[id]`); a paid approved/used ticket (incl. a walk-in) is **Voided** (`POST` `{action:"void"}`): QR dead, out of revenue, kept, seat freed | staff delete, owner void |
| **Staff account** | **Delete** (`DELETE …/staff/[id]`), or deactivate (existing); past records keep working, just without their name; owner account can't be deleted | owner |
| Gym photos, WhatsApp token | Remove (existing) | owner / superadmin |
| **Gym** created by mistake | **Delete** only while it has no members, visits or payments; type the slug to confirm; audit-logged (`DELETE /api/superadmin/gyms/[id]`); otherwise suspend | superadmin |
| Invoice (superadmin) | Void only, so invoice numbers stay unbroken (existing) | superadmin |
| Platform subscription payments, audit log, notification log, login attempts | Not deletable on purpose: billing history, the audit trail and the WhatsApp allowance count depend on them | none |

New guest ticket state `VOIDED` (migration `20261026000000_guest_pass_voided`).
Shared helper `tenantOrResponse` (`src/lib/routeAuth.ts`) gives routes the standard session checks
and an optional owner-only gate. Tests: `e2e/37-deletes.spec.ts`.

## 5. Installable app (PWA)

Liftmora can be installed to a phone's home screen and opens full screen like an app (staff scanning
at the door, members showing their QR, owners checking the dashboard). One install serves everyone.

- **Manifest** `src/app/manifest.ts` → `/manifest.webmanifest`: name, dark brand colours, standalone,
  and icons (192, 512, plus a *maskable* 512 for Android's round crops). Icons live in `public/icons`
  and come from the plate mark: re-make them with `CHROMIUM_PATH=… node scripts/make-pwa-icons.mjs`
  (only needed if the mark changes). `src/app/layout.tsx` adds the theme colour, the iPhone
  home-screen icon and the web-app meta tags.
- **Entry point** `/open` (the manifest's `start_url`): signed-in staff go to their gym's dashboard,
  members to `/my`, the superadmin to the platform dashboard, everyone else to `/login`.
- **Service worker** `public/sw.js` (served uncached, scope `/`, via `next.config.mjs`). It only:
  keeps `/offline.html` and the icons, shows the offline page when a page load fails, and caches
  fixed files (`/_next/static`, `/icons`). It **never stores pages or API responses**, so no member
  data, QR code or payment can be read from a phone's cache, and nothing shown is out of date.
  Bump `CACHE` in `sw.js` if the cached file list changes.
- **Registration + install banner** `src/components/PwaSupport.tsx`: registers the worker in
  production builds only (so dev and tests aren't confused by caches), and shows an "Install
  Liftmora" banner inside the app only (not on the marketing site, login, legal pages or one-off links
  like a guest ticket). Chrome/Android get an Install button; iPhone, which has no install prompt,
  gets "Share → Add to Home Screen". "Not now" snoozes it for 14 days; nothing shows once installed.
- **"Install the app" button** (`src/components/InstallAppButton.tsx`) on the login pages (`/login` and a
  gym's own login, which the member entry redirects to). It decides what to do per device
  (`detectInstallKind` in `src/lib/pwaInstall.ts`): where the browser offers its install prompt, one tap
  installs; otherwise it opens a short guide for that device. **iPhone/iPad Safari:** Share → Add to Home
  Screen. **iPhone in Chrome, Firefox or an in-app browser** (WhatsApp, Instagram): says only Safari can
  install and gives a *Copy link* button. **Mac Safari:** File → Add to Dock. **Android / Chrome or Edge on
  a computer** without a prompt yet: the menu or address-bar icon. Hidden once installed and on Firefox
  for computers. Newer iPads (which report themselves as a Mac but have a touch screen) are recognised.
  The in-app banner uses the same detection and also says "open in Safari" where that's the only way.
  Tests: `e2e/40-install-button.spec.ts`.
- **Not included, on purpose:** offline check-in or offline member QR. Those need member data stored on
  the phone, which is a privacy and fraud trade-off worth deciding separately. Push notifications
  also aren't included (reminders go out by WhatsApp).
- Tests: `e2e/38-pwa.spec.ts` (manifest and icons, headers, `/open`, the real worker going offline in a
  browser, the install banner on Android-style and iPhone).

## 6. Invoice discounts (superadmin invoice maker)

**Each line item can have its own discount**: a percentage (0–100%) or a fixed rupiah amount off that
line (price × quantity). Items without one are charged in full.

- **Form** `/superadmin/invoices/new`: every item has a "No discount / % off / Rp off" control under it.
  The item shows what it comes to (the full price struck through, the discounted amount, and what was
  taken off), and a summary shows Items, Item discounts and Total, live, using the same maths as the
  server (`src/lib/invoiceMath.ts`, no server code in it so the browser can share it).
- **Server is the authority** (`POST /api/superadmin/invoices`): line amounts, the subtotal and the total
  are always recomputed; a total sent by the client is ignored. Percentages round to the nearest whole
  rupiah; a fixed amount must be whole rupiah and no more than that line's price; a line can be 100% off.
  A line discount that comes to Rp 0 (e.g. a percentage of a free line) is dropped. Invalid input is a
  400 with a plain message.
- **Data**: the discount is stored on each item inside `Invoice.items` (no new columns for it).
  `Invoice.subtotal` is the sum of the lines **after** their discounts, and `total` is still what is
  payable, so the invoice list, "outstanding" and everything else that reads `total` need no change.
- **Printed invoice**: a Discount column appears only when some line has one, each line's Amount is
  after its discount, and the foot reads **Total due**, "Items before discounts", and "You save".
  Invoices with no discounts look exactly as before.
- **Also still supported (server only):** one discount on the *whole* invoice (`discount` with `type`,
  `value`, optional `label`), applied after the line discounts. The form no longer offers it; invoices that
  used it (from `20261026010000_invoice_discount`) still print correctly, with Subtotal and Discount rows.
- Tests: `e2e/39-invoice-discount.spec.ts` (maths and rounding, per-line and stacked discounts, validation
  limits, the printed sheet, an old invoice, and the form's live updates in a browser).

## 7. Reliable QR scanning

Real-camera scanning was the least-tested part of the app, so it was hardened.

- **Codes unchanged**: compact tokens were tried and reverted; member, ticket and poster QRs keep their original format, so nothing issued or printed is affected.
- **Scanner**: the scanner itself is the one on main (native detector, HD camera, scaling scan box); the earlier helper was dropped in favour of it.
- Tests: `e2e/41-scan.spec.ts` plays a QR through Chromium's **fake camera** into the real scanner page
  (valid member code gives "Checked in" and a `CheckIn` row; an unknown code gives "Invalid QR code"), and
  checks token signature and tampering.
- No migration needed.

## 8. Email via Mailgun, with per-gym templates

- **One sender** (`src/lib/email.ts`): every email leaves from Liftmora's single address (`EMAIL_FROM`; Mailgun
  defaults to `no-reply@<domain>`, display name `EMAIL_FROM_NAME`, default "Liftmora"). Nothing about the sender
  is per gym. Mailgun is used when `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` are set (`MAILGUN_REGION=eu` for EU
  domains), then Mailjet (`MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, and `EMAIL_FROM` set to a sender verified in Mailjet), then Resend; `EMAIL_PROVIDER` forces one. Plain text plus a simple HTML version; a
  gym can set a reply-to address so replies reach it.
- **The template tells gyms apart** (`EmailTemplate` table): a row with a `gymId` is that gym's own template for
  a message type; a row with **no gym is the platform default** gyms fall back to. Lookup, most specific first:
  the gym's template for the type, the gym's "everything else", the platform's template for the type, the
  platform's "everything else", then the wording built into the app. One platform row per type is enforced by
  a partial unique index. Deleting a gym deletes its templates.
- **Message types are an enum**: the 14 kinds of message the system sends (plus `default`, the "everything else" slot) are the
  `MessageType` enum in the database (`EmailTemplate.type`) and `MESSAGE_TYPES` in code, kept identical by a test;
  WhatsApp and email sends are typed with it, so a made-up type won't compile. `guest_ticket` and `guest_rejected` are
  WhatsApp-only (guests have no email), so they have no template.
- **Config-driven** (`src/config/email.ts`): message types, placeholders (`{{gymName}}`, `{{memberName}}`,
  `{{gymAddress}}`, `{{message}}`) and the built-in wording are data. Adding a message type is one line.
- **Editing**: owners edit in Settings, "Email templates" (`POST /api/[slug]/email-templates`, owner only), with
  a live preview and "Back to default". Platform defaults are plain `EmailTemplate` rows with no `gymId`.
- **Isolation**: row-level security limits a gym to its own rows; the platform rows are read with the system
  client (sending and the settings page).
- **Safety** (`src/lib/emailTemplates.ts`): only known placeholders, the body must keep `{{message}}` (it
  carries the link and dates), subjects are one line, values are filled in one pass (no placeholder
  injection), HTML is escaped.
- **Deploy**: needs `npm run db:migrate` then `npm run db:rls`.
- Tests: `e2e/42-email-templates.spec.ts`.

## 9. Changing a member's email cancels their password links

When staff change a member's email (member detail, Edit), every unused link that lets someone set that member's
password is revoked on the spot: the activation link from when they were added and any password-reset link.
A link already sent to the old address or phone, or sitting in an old message, can't be used to take over the
account. Saving the same email, or editing only the name, phone or plan, revokes nothing. The QR-only fallback
link isn't a password link and keeps working. Staff can send a new link afterwards ("Send password link"). The
edit response reports `linksRevoked`. Only that member's links are touched. No migration.
Code: `revokeMemberPasswordLinks` in `src/lib/magicLink.ts`. Tests: `e2e/43-email-change-revokes-links.spec.ts`.

## 10. HTML emails

Every member email goes out as a designed HTML email as well as plain text (`htmlEmail` in
`src/lib/emailTemplates.ts`), in Liftmora's black and plate yellow, dark all the way through (no white panel): a bar with the Liftmora mark, a
hero with a yellow badge for that kind of message (a check, a lock, a calendar, a receipt...), the gym's name
in yellow and a big white heading, a barbell divider drawn from table cells, the message (links clickable), a
yellow button with an arrow to the first link when the message has one (activation, welcome, renewal, password
reset, QR link), and a black footer with the gym's name and address. Built from tables and inline styles so
email apps render it; everything a gym or member can type is escaped. The look is data in `src/config/email.ts`
(`EMAIL_BRAND` colours, `EMAIL_DESIGN` heading and button label per message type). A gym edits the wording
(subject and body) as before; the frame is the same for every gym.

Images: the logo (`public/icons/email-logo.png`, made by `scripts/make-pwa-icons.mjs`) and the 13 badges
(`public/email/<type>.png`, made by `scripts/make-email-assets.mjs`) are loaded from `NEXT_PUBLIC_APP_URL`,
because email apps block embedded images; they only appear once this version is deployed. The name is also text.
See every email with sample data: `npx tsx scripts/preview-emails.ts [dir]` (images embedded). No migration.
Tests: `e2e/42-email-templates.spec.ts`.

## 11. System emails (Liftmora to a gym's owner and staff)

Liftmora's own messages to the people who run a gym now go out as email as well as WhatsApp (`notifyOwner` in
`src/lib/notify.ts`): to the phone and the email address they have, whichever exists. Unlike member messages
these aren't the gym's to switch off, since they cover billing and access. Every attempt is logged against the
gym (`NotificationLog`, channel `whatsapp` or `email`). The six kinds, all in the `MessageType` enum:

- `gym_welcome`: a gym was set up, by a superadmin or by self-serve sign-up (login address, trial if any)
- `subscription_due`: the renewal invoice, with the pay or upload-proof link
- `subscription_paid`: **new**, a receipt when a subscription payment is confirmed, online or by a bank
  transfer a superadmin confirms, saying what the gym is covered until
- `gym_suspended`: the gym was suspended for non-payment, with the link to pay
- `staff_invite` and `staff_password_reset`: a staff or owner link to set a password

They use the same dark HTML design (a badge each, "Sent by Liftmora about <gym>" in the footer). The wording is
the platform's, never a gym's: `DEFAULT_SYSTEM_EMAIL_TEMPLATES` and `SYSTEM_EMAIL_DESIGN` in
`src/config/email.ts`, and an `EmailTemplate` row with no gym for one of these types overrides it (there is no
screen for that yet). A gym's own templates are ignored for them. `{{recipientName}}` is a new placeholder.
Migration: the `MessageType` enum gained the six values (same new migration as the email templates, so
`npm run db:migrate` and `npm run db:rls` as before). Tests: `e2e/42-email-templates.spec.ts`.
