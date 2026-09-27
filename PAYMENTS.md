# Payments

Every online payment (a member's membership, a new gym's signup, a gym's subscription) goes through one
payment provider, chosen by `PAYMENT_PROVIDER`:

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
