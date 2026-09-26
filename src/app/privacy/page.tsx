import type { Metadata } from "next";
import LegalPage, { ContactLine } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy · Iron Ledger" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="26 September 2026">
      <p>
        This explains what personal data Iron Ledger handles, why, who sees it and what you can do about it.
        We follow applicable data protection law, including Indonesia&apos;s Personal Data Protection Law (UU 27/2022).
      </p>

      <h2>Who is responsible</h2>
      <p>
        Your gym decides why and how your membership data is used, so for members the <strong>gym is the data controller</strong>.
        Iron Ledger provides the software and processes that data on the gym&apos;s behalf. For gym owner and staff accounts,
        and for the subscription itself, Iron Ledger is the controller.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Members:</strong> full name, email, WhatsApp number, password (stored only as a hash), an optional profile photo, membership plan and dates, check-in times and results, and payment records (amount, date, status).</li>
        <li><strong>Gym owners and staff:</strong> name, email, phone number for account help and billing notices, password (hashed), and the gym&apos;s subscription and invoices.</li>
        <li><strong>Technical:</strong> a secure session cookie to keep you logged in. To limit abuse we keep a keyed hash of your IP address on sign-up and password-reset requests, not the address itself.</li>
      </ul>
      <p>We never see or store card numbers or bank logins. Online payments are taken on Xendit&apos;s page.</p>

      <h2>Why we use it</h2>
      <ul>
        <li>To run memberships: sign you in, show your QR code, record check-ins, extend your membership when you pay.</li>
        <li>To send service messages on WhatsApp: activation and password links, receipts, expiry reminders and billing notices.</li>
        <li>To keep the service secure and to prevent abuse and fraud.</li>
        <li>To keep financial records that our customers and we need for accounting and tax.</li>
      </ul>
      <p>We do not sell personal data and we do not use it for advertising.</p>

      <h2>Who else handles it</h2>
      <ul>
        <li>The <strong>gym</strong> you belong to, and its staff, can see your member details and history. Lists show your phone and email partly masked.</li>
        <li><strong>Suppliers</strong> that run the service for us: hosting (Vercel), database (Neon), payments (Xendit), WhatsApp delivery (Fonnte or a similar gateway) and image storage (Vercel Blob). They handle data only to provide their service, and some are located outside Indonesia.</li>
        <li>Authorities, when the law requires it.</li>
      </ul>

      <h2>How we protect it</h2>
      <p>
        Phone numbers are encrypted in the database and passwords are hashed. Every gym&apos;s data is kept apart, enforced in the application
        and again inside the database, so one gym cannot read another&apos;s. Connections are encrypted. No system is perfectly secure; if a breach
        affects you we will notify you and the authorities as the law requires.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your data while your account exists. If you delete your account, or your gym erases you, your name, email, phone, photo and login are
        removed. Payment and visit records stay, with no personal details attached, because the gym needs them for its accounts.
      </p>

      <h2>Your rights</h2>
      <p>You may ask to see your data, correct it, restrict or object to how it is used, withdraw consent, or have it deleted, and you may complain to the data protection authority.</p>
      <ul>
        <li><strong>Members:</strong> you can delete your account and data yourself from your dashboard (&ldquo;Delete my account and data&rdquo;). For anything else, ask your gym, or contact us and we will pass it on.</li>
        <li><strong>Gym owners and staff:</strong> contact us.</li>
      </ul>

      <h2>Cookies</h2>
      <p>We use one cookie, needed to keep you signed in, plus a theme preference. There are no advertising or tracking cookies.</p>

      <h2>Children</h2>
      <p>The service is not aimed at children. A person under 18 should only join a gym with a parent or guardian&apos;s agreement.</p>

      <h2>Changes and contact</h2>
      <p>
        If we change this policy the date above changes, and for significant changes we will tell gym owners. Questions or requests: <ContactLine />.
      </p>
    </LegalPage>
  );
}
