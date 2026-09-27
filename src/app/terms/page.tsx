import type { Metadata } from "next";
import LegalPage, { ContactLine } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms of Service · Repstack" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="26 September 2026">
      <p>
        These terms apply when you use Repstack, a service that helps gyms manage memberships, payments and check-ins
        (&ldquo;the service&rdquo;). By creating an account, joining a gym through Repstack or otherwise using the service you agree to them.
      </p>

      <h2>1. Who is who</h2>
      <ul>
        <li><strong>Repstack</strong> (&ldquo;we&rdquo;) runs the software.</li>
        <li><strong>Gym owners</strong> subscribe to Repstack to run their gym. Each gym is a separate customer.</li>
        <li><strong>Members</strong> buy a membership from a gym. Your membership is an agreement between you and that gym; we provide the tools and are not a party to it.</li>
      </ul>

      <h2>2. Accounts</h2>
      <p>
        Give accurate details and keep your password to yourself. You are responsible for what happens under your account.
        Tell us or your gym promptly if you think someone else has got in. People under 18 need a parent or guardian to agree to these terms for them.
      </p>

      <h2>3. Gym owners</h2>
      <ul>
        <li>You pay the subscription for your plan, monthly or yearly, in rupiah through our payment provider (Xendit or Midtrans). Prices are shown before you pay.</li>
        <li>Your plan sets limits on members, staff accounts and WhatsApp messages each month. Some actions stop when a limit is reached until you upgrade or the month rolls over.</li>
        <li>If a renewal is not paid, your gym is marked past due. After a 3-day grace period the gym is suspended: staff and members cannot log in or check in until the subscription is paid.</li>
        <li>Subscription payments are not refundable once a period has started, except where the law requires it.</li>
        <li>You are responsible for the members&apos; data that you enter or collect through the service, for having a lawful basis to hold it, and for the messages sent in your gym&apos;s name.</li>
        <li>You decide your own membership plans, prices and rules. Members&apos; online payments are processed by our payment provider, and you are responsible for refunds, disputes and taxes on what you charge.</li>
      </ul>

      <h2>4. Members</h2>
      <ul>
        <li>Membership prices, duration, freezing, cancellation and refunds are set by your gym. Ask them if you are unsure.</li>
        <li>Your check-in QR code is personal. Do not share it. A gym can cancel it at any time.</li>
        <li>You can delete your account and personal data yourself from your dashboard. This ends your membership immediately without a refund.</li>
      </ul>

      <h2>5. Messages</h2>
      <p>
        We send activation links, receipts, reminders and similar service messages by WhatsApp on behalf of your gym, using our own sender number.
        You must not use the service to send spam, harassment or anything unlawful.
      </p>

      <h2>6. Acceptable use</h2>
      <p>
        Do not try to break, overload or get around the security of the service, access another gym&apos;s data, scrape it, or use it to break the law.
        We may suspend or close accounts that do, and we may suspend a gym that puts others at risk.
      </p>

      <h2>7. Your data</h2>
      <p>
        How we handle personal data is described in the <a href="/privacy" className="underline underline-offset-2 hover:text-white">Privacy Policy</a>.
        Gym owners can ask us for their gym&apos;s data when they leave; we delete a closed gym&apos;s data after a reasonable period unless the law says we must keep some of it.
      </p>

      <h2>8. Availability and changes</h2>
      <p>
        We work to keep the service running, but it is provided &ldquo;as is&rdquo; and may sometimes be unavailable, for example for maintenance or because of a supplier outage.
        We may improve or change features, and will give notice of changes that materially reduce what a paying gym receives.
      </p>

      <h2>9. Liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or consequential losses such as lost revenue, and our total liability for anything
        arising from the service is limited to the subscription fees the gym paid us in the three months before the claim.
        Nothing here limits liability that cannot be limited by law.
      </p>

      <h2>10. Ending the agreement</h2>
      <p>
        A gym owner may stop subscribing at any time; access continues until the paid period ends. We may end or suspend access for breach of these terms or non-payment.
      </p>

      <h2>11. Governing law</h2>
      <p>These terms are governed by the laws of the Republic of Indonesia. Disputes go first to good-faith discussion, then to the courts of Indonesia.</p>

      <h2>12. Changes and contact</h2>
      <p>
        We may update these terms; the date above shows the latest version, and continuing to use the service after a change means you accept it.
        Questions: <ContactLine />.
      </p>
    </LegalPage>
  );
}
