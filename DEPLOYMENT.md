# Deploying Repstack

A first production deploy on Vercel + Neon, in order. Tick each box as you go. Everything here uses scripts
already in the repo; nothing needs code changes. Commands are written for PowerShell on Windows; the Git Bash
equivalent is `VAR=value command`.

Related docs: `prisma/RLS.md` (row-level security in depth), `PAYMENTS.md` (turning on Xendit or Midtrans
later), `prisma/MIGRATIONS.md` (schema workflow).

## 0. Before you start

- [ ] Accounts: Vercel, Neon, Fonnte (you have this). A domain is optional for a pilot (Vercel gives a
      `*.vercel.app` address), but activation links and QR codes carry the address, so pick the real one
      before real members get links.
- [ ] A password manager open. You are about to create several secrets and two of them are unrecoverable.
- [ ] `main` is what you deploy. CI (type check and the e2e suite) runs on every push to `main`; make sure the
      latest run is green on GitHub before you deploy.
- [ ] Plan terms: Vercel's free (Hobby) plan is for non-commercial use. See "Costs and plan" at the bottom.

## 1. Database (Neon)

- [ ] Create a Neon project. Pick the region closest to your gyms (Singapore for Indonesia).
- [ ] Copy two connection strings from the dashboard (toggle "Pooled connection"):
  - **Direct** (host without `-pooler`): used for migrations and the one-off scripts below.
  - **Pooled** (host with `-pooler`): used by the app at runtime.
- [ ] Both need `?sslmode=require`.

## 2. Generate the secrets

Make four different values (any random 32+ bytes):

```powershell
# PowerShell: run it four times, one per secret
[Convert]::ToHexString((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

(or `openssl rand -hex 32` in Git Bash). Name them:

| Variable | What it protects |
|---|---|
| `JWT_SECRET` | login sessions |
| `QR_SERVER_SECRET` | member QR codes |
| `ENCRYPTION_KEY` | member phone numbers and gym WhatsApp tokens, encrypted in the database |
| `LOOKUP_HMAC_KEY` | finding a member by phone number |

- [ ] Save all four in the password manager **now**.
- [ ] **`ENCRYPTION_KEY` and `LOOKUP_HMAC_KEY` can never be changed or lost.** Lose or change either and stored
      phone numbers become unreadable and phone lookups stop matching. Back them up somewhere separate.
- [ ] Also generate `CRON_SECRET` (same command) and, for the restricted database role, a long
      `APP_DB_PASSWORD` (12+ characters).

## 3. Migrations and row-level security (from your laptop)

Run these against the **direct** connection string, setting the variable only for this shell session so the
production URL never lands in your local `.env`.

```powershell
$env:DATABASE_URL = "postgresql://<owner>:<password>@<direct-host>/<db>?sslmode=require"

npm run db:migrate          # applies every pending migration; never resets
```

- [ ] Migrations applied without errors (the last two this release are `platform_transfer_proof` and
      `member_gym_board_privacy`).

```powershell
$env:APP_DB_PASSWORD = "<the long password from step 2>"
npm run db:rls              # creates the restricted app role and applies the policies; safe to re-run
```

- [ ] It prints the role name (default `iron_app`). Build the app's runtime connection string from it, **pooled
      host**, with pgbouncer on:

```
APP_DATABASE_URL=postgresql://iron_app:<APP_DB_PASSWORD>@<pooled-host>/<db>?sslmode=require&pgbouncer=true
```

```powershell
$env:APP_DATABASE_URL = "<the string above>"
npm run db:rls:check        # must end with every line PASS
```

- [ ] `db:rls:check` passes. If any line says FAIL, stop and fix it before going on (see "If something fails").
- [ ] Clear the session when done: `Remove-Item Env:DATABASE_URL, Env:APP_DATABASE_URL, Env:APP_DB_PASSWORD`.

Do not run `npm run db:seed`: it creates demo data and a superadmin with a known password.

## 4. Create your superadmin

```powershell
$env:DATABASE_URL = "<direct owner connection string>"
$env:SUPERADMIN_PASSWORD = "<a long password, 12+ characters>"
npm run admin -- create --email you@yourdomain.com --name "Your Name"
```

- [ ] Created. Keep the password in the password manager. To reset it later:
      `npm run admin -- reset-password --email you@yourdomain.com`.
- [ ] Clear the session variables afterwards.

## 5. Vercel project and environment variables

- [ ] Import the GitHub repo, branch `main`. Defaults work (`next build`).
- [ ] Add the Blob store (Storage tab, "Blob"): this gives you `BLOB_READ_WRITE_TOKEN`.
- [ ] Set these environment variables for **Production**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the database **owner** user (used for login, webhooks, cron and the superadmin, not for gym pages). Use the pooled host and add `&pgbouncer=true`, as Neon recommends for serverless functions |
| `APP_DATABASE_URL` | the restricted-role string from step 3 (pooled host, `pgbouncer=true`) |
| `JWT_SECRET`, `QR_SERVER_SECRET`, `ENCRYPTION_KEY`, `LOOKUP_HMAC_KEY` | from step 2 |
| `CRON_SECRET` | from step 2. Vercel sends it to your cron routes automatically |
| `NEXT_PUBLIC_APP_URL` | the real address, with `https://` and no trailing slash |
| `BLOB_READ_WRITE_TOKEN` | from the Blob store |
| `PLATFORM_WHATSAPP_PROVIDER` | `fonnte` |
| `PLATFORM_WHATSAPP_API_KEY` | your Fonnte token (the platform's shared number) |
| `NEXT_PUBLIC_CONTACT_EMAIL` | the address shown on the terms and privacy pages |

Leave these **unset**:

- `PAYMENTS_ENABLED`: unset means gym subscriptions are paid by bank transfer, which is what you want for now.
- every `*_MOCK` variable (`PAYMENTS_MOCK`, `XENDIT_MOCK`, `WHATSAPP_MOCK`, `EMAIL_MOCK`): they are ignored in
  production anyway, but keep them out.
- `XENDIT_*` and `MIDTRANS_*`: until a provider approves you (see `PAYMENTS.md`).
- `RESEND_API_KEY` / `EMAIL_FROM`: email to members is optional.

- [ ] Deploy. If `APP_DATABASE_URL` was added after the first deploy, redeploy so the app picks it up.
- [ ] In the function logs there is **no** line saying `APP_DATABASE_URL is not set`. That line means row-level
      security is not being enforced.
- [ ] Add your domain under Settings > Domains and confirm `NEXT_PUBLIC_APP_URL` matches it exactly.

## 6. First login and setup

- [ ] Open `https://<your-address>/superadmin/login` and sign in with the account from step 4.
- [ ] **Platform settings**: enter the bank account (bank, account number, account holder) that gym owners
      transfer their subscription to. Until you do, owners see "our bank details aren't set up yet".
- [ ] Create your first gym (Gyms > New gym tenant). Leave **Lifetime** unticked so it starts the 30-day trial.
      Optionally add a setup fee.
- [ ] If the gym should send from its own WhatsApp number, add its Fonnte token on the gym's row (WhatsApp
      button), then press Test. Otherwise it uses your shared number.
- [ ] Give the owner their temporary password and ask them to change it, or use "Owner link" to send a
      one-time reset link.

## 7. Cron jobs

`vercel.json` declares three daily crons. All must be daily for the free plan.

| Route | When (UTC) | What it does |
|---|---|---|
| `/api/cron/subscriptions` | 01:00 | invoices gyms whose trial or billing date has arrived; suspends those 3 days past due |
| `/api/cron/member-reminders` | 02:00 | expiry reminders; marks expired members |
| `/api/cron/class-reminders` | 11:00 (18:00 Jakarta) | reminds everyone confirmed for tomorrow's classes |

- [ ] In Vercel > Settings > Cron Jobs, all three are listed.
- [ ] Trigger one by hand and confirm it answers (not 401):

```powershell
curl.exe -H "Authorization: Bearer <CRON_SECRET>" https://<your-address>/api/cron/class-reminders
```

On the free plan Vercel may run a daily cron any time inside its hour, so the 18:00 reminder can land a little
later than 18:00.

## 8. Test on real phones

Do this once before any gym relies on it. Use a throwaway gym and member.

- [ ] A member opens the WhatsApp activation link, sets a password and a photo, and logs in.
- [ ] The member's QR shows on the phone; staff scan it on a second phone and see the green result.
- [ ] A member scans the gym's poster QR with their own phone and checks themselves in. Camera access needs
      HTTPS, which the real domain gives you.
- [ ] A second scan the same day shows "Already checked in today" (unless you changed the daily limit).
- [ ] Owner records a cash payment; the member's page shows the new expiry.
- [ ] Book a class as a member; staff mark attendance.
- [ ] As the owner, open Billing, start a bank-transfer payment and upload a proof image; as superadmin, view
      it and confirm. The gym's status moves from TRIALING to ACTIVE.
- [ ] Links in WhatsApp messages open the real address, not `localhost`.

## 9. Before real members

- [ ] Delete the throwaway test gym.
- [ ] Neon: note how to restore (Branches / point-in-time restore). On the free plan history is short; take a
      manual copy before the first real week (the members CSV from each gym, plus a Neon branch or `pg_dump`).
- [ ] Decide who gets alerted if it breaks. Watch Vercel's function logs daily for the first week.
- [ ] Tell the pilot gym owners what trial means and when the first invoice arrives (day 30).

## If something fails

- **`db:rls:check` fails:** the app role must not be a superuser and must not bypass row-level security;
  re-run `npm run db:rls` with the owner `DATABASE_URL`, and make sure `APP_DATABASE_URL` uses the new role, not
  the owner.
- **Migration errors on Neon:** run it against the direct (non-pooler) host.
- **Startup log says `APP_DATABASE_URL is not set`:** add it and redeploy; until then tenant queries run
  without row-level security.
- **Members or owners see links to `localhost`:** `NEXT_PUBLIC_APP_URL` is wrong or missing; fix it and redeploy.
- **WhatsApp messages not arriving:** a message with no token is logged as skipped. Check
  `PLATFORM_WHATSAPP_API_KEY`, or the gym's own token via the WhatsApp button and Test.
- **Phone numbers show as unreadable after a deploy:** `ENCRYPTION_KEY` changed. Restore the original value.
- **A bad release:** in Vercel, promote the previous deployment back to Production (Deployments > Promote).
  Migrations are additive, so rolling the code back does not need a database change.

## Costs and plan

Rough figures from list prices (check each provider's current pricing):

- Pilot on Vercel Hobby + Neon free: about Rp 35k a month (Fonnte and a domain).
- Vercel Pro is about $20 a month. Hobby is for non-commercial use only; move to Pro when a gym first pays.
- Neon free suspends when idle (a slow first request after a quiet spell); upgrade around gym 3 to 5.
- Break-even on Pro is about 2 gyms at Rp 300k a month.
