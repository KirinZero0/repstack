# Payments

## Online payments are currently OFF

Every online invoice everywhere in the app — a member added directly by staff, a member's own plan-change
payment, a gym's monthly/annual subscription (manual "pay now", plan upgrades, and the daily renewal cron),
and self-serve gym sign-up — is switched off by default. `createInvoice()` and `openPlatformInvoice()`
(`src/lib/gateway.ts`, `src/lib/platformBilling.ts`) refuse to create a real invoice unless
`PAYMENTS_ENABLED=1` is set; every call site checks this and shows a plain "online payments are currently
turned off" message instead of erroring. The subscription cron also skips creating renewal invoices and
skips suspending gyms for non-payment while this is off, since there'd be no way for them to pay their way
out. Mock mode (`PAYMENTS_MOCK=1`, dev/test only) bypasses this switch entirely and keeps working as before.

Turning it back on is a one-line env change in Vercel — set `PAYMENTS_ENABLED=1` — no code change needed.

The public join page (`/[slug]/join`) doesn't use this switch at all: it never used an online gateway in
the first place. A prospective member transfers their fee straight to the gym's own bank account (set in gym
settings) and submits a request, optionally with a proof-of-transfer image, that staff reviews and approves
on `/[slug]/members` ("Pending requests"). No member money passes through the platform's own
payment-provider account this way — see "Who receives the money" below for why that matters.

## Providers

Once `PAYMENTS_ENABLED=1`, every online payment goes through one payment provider, chosen by `PAYMENT_PROVIDER`:

| Value | Provider |
|---|---|
| `xendit` (default) | Xendit invoices |
| `midtrans` | Midtrans Snap payment pages |

Both providers end in the same place: their webhook is turned into one `PAID` or `EXPIRED` event and passed to
`processPaymentEvent` (`src/lib/payments.ts`), which is idempotent. Provider-specific code lives in
`src/lib/xendit.ts` and `src/lib/midtrans.ts`; everything else calls `src/lib/gateway.ts`.

Each `Payment` / `PlatformPayment` remembers which provider created it, so switching `PAYMENT_PROVIDER` later
only affects new invoices. Unpaid invoices made with the old provider keep working.

## Midtrans

Environment (Vercel):

```
PAYMENT_PROVIDER=midtrans
MIDTRANS_SERVER_KEY=          # Settings > Access Keys > Server Key. Sandbox and production keys differ.
MIDTRANS_IS_PRODUCTION=1      # only with production keys; leave empty for the sandbox
```

In the Midtrans dashboard (use the environment switch at the top for sandbox or production):

1. Settings > Configuration > **Payment Notification URL**: `https://<your-domain>/api/webhooks/midtrans`.
2. Optionally set the Finish / Unfinish / Error redirect URLs; the app also sends a finish URL per payment.
3. Turn on the payment methods you want (bank transfer / virtual accounts, QRIS, e-wallets, cards).

Behaviour to know:

- The order id is our record id plus `~` and a random suffix, because Midtrans never accepts the same order
  id twice. The webhook cuts at the `~` to find the record.
- Only `settlement` (and `capture` with fraud status `accept`) count as paid; `expire` and `cancel` expire the
  record. `pending`, `deny`, `failure` and held card payments are acknowledged and ignored, since the customer
  can still try again until the page expires (24 hours).
- Notifications are verified with the SHA-512 signature over order id, status code, gross amount and server key.
- Amounts are whole rupiah. IDR only.
- An unused Snap page can't be cancelled early; it simply times out. A retired invoice is ignored if it is paid
  late, so don't reuse links.

## Xendit

```
PAYMENT_PROVIDER=xendit
XENDIT_SECRET_KEY=
XENDIT_CALLBACK_TOKEN=        # you choose it; must match the callback token in the Xendit dashboard
```

Set the invoice callback URL to `https://<your-domain>/api/webhooks/xendit`.

## Local development and tests

`PAYMENTS_MOCK=1` (or the older `XENDIT_MOCK=1`) fakes invoice creation and shows an in-app "simulate payment"
button, whichever provider is selected. It is ignored in production.

## Who receives the money

Invoices pay out to the account that created them. Right now every payment, including a member's membership
fee, goes to the platform's own provider account. Paying gyms their share (or giving each gym its own
sub-account) is not built. Decide this before taking real member payments.
