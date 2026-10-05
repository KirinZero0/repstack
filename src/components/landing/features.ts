/**
 * The feature catalogue, in the words a gym owner uses. The home page shows a summary of each
 * group; /features shows everything. Keep it true to what the app does today: a line here is a
 * promise in a sales conversation.
 */

export interface FeatureGroup {
  id: string;
  title: string;
  /** One sentence under the title. */
  lede: string;
  /** Which plate colour marks this group. */
  color: "yellow" | "green" | "blue" | "red";
  items: { title: string; body: string }[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "members",
    title: "Members",
    lede: "Everyone who trains with you, in one list you can search, export and trust.",
    color: "yellow",
    items: [
      {
        title: "Add one, or import the whole spreadsheet",
        body: "Type a member in at the desk, or upload the CSV you already keep. The import reads Indonesian Excel files (semicolons, \"No. HP\", \"Berlaku sampai\", day-first dates), previews every row with what will happen, and skips anyone already on your roster.",
      },
      {
        title: "Members activate themselves",
        body: "A new member gets a WhatsApp link, sets their own password, adds a photo, and sees their check-in QR. No passwords typed over the counter.",
      },
      {
        title: "A public join page",
        body: "Anyone with your link or poster picks a plan, transfers to your bank account and sends the proof. You approve it from one queue and they are a member.",
      },
      {
        title: "Freeze, cancel, edit, erase",
        body: "Pause a membership and the clock stops. Cancel and the QR stops working. Erase a member's personal data on request while the payment history still adds up.",
      },
      {
        title: "Search and export",
        body: "Find anyone by name or phone number. Download the roster as CSV whenever you like. Your members are your data.",
      },
    ],
  },
  {
    id: "checkin",
    title: "Check-in at the door",
    lede: "Members scan a poster with their own phone. Nobody has to mind a webcam.",
    color: "green",
    items: [
      {
        title: "Print one poster",
        body: "Your gym's check-in QR goes on the wall. Members scan it from their dashboard and get a green, amber or red screen in a second.",
      },
      {
        title: "Or scan them",
        body: "Staff can scan a member's own QR from the staff scanner, for the member whose phone died or who never set up their account.",
      },
      {
        title: "Rules that hold",
        body: "One visit per member per day. Expired, frozen and cancelled memberships are refused with a clear reason. A QR from another gym is rejected outright.",
      },
      {
        title: "Who's in the gym now",
        body: "The dashboard shows who checked in recently and has not left. Members tap out when they go, staff can check anyone out, and the rest drop off after a window you set.",
      },
      {
        title: "Forgot their password at the door?",
        body: "Send a one-time QR link over WhatsApp from their member page. They open it and scan. No account recovery at 6 am.",
      },
    ],
  },
  {
    id: "payments",
    title: "Plans, payments and renewals",
    lede: "Define your plans once. Take money the way your members already pay you.",
    color: "blue",
    items: [
      {
        title: "Your plans, your prices",
        body: "Monthly, quarterly, annual, a student week pass: any length, any price. Hide a plan to stop selling it without losing the members on it.",
      },
      {
        title: "Record desk payments in seconds",
        body: "Cash or a transfer you saw land: pick the plan, confirm the amount, done. The membership extends, the member gets a receipt on WhatsApp, and a mistaken entry can be voided.",
      },
      {
        title: "Members renew by bank transfer from their phone",
        body: "They pick a plan on their dashboard, see your account number, transfer, attach the screenshot. You confirm it from the same queue as join requests and the renewal is done.",
      },
      {
        title: "Online payments when you want them",
        body: "Switch on Xendit or Midtrans and members can pay by card, e-wallet or virtual account from a hosted page. Memberships activate the moment the payment clears.",
      },
      {
        title: "Nobody slips through",
        body: "A WhatsApp reminder three days before a membership ends. Lapsed memberships are marked expired automatically and the member is told.",
      },
    ],
  },
  {
    id: "classes",
    title: "Classes",
    lede: "Yoga on Tuesday, spin on Thursday, a roster that fills itself.",
    color: "red",
    items: [
      {
        title: "Set up a class, schedule the weeks",
        body: "Name, instructor, price, length, seats. Schedule a session once or repeat it weekly for as long as you like. Cancel one session and everyone booked is told.",
      },
      {
        title: "Members book from their dashboard",
        body: "Upcoming sessions by day with seats left. Free classes confirm instantly. Paid ones hold the seat while they pay online or at the desk.",
      },
      {
        title: "Rosters, attendance, no-shows",
        body: "Staff see who booked and who paid. From half an hour before the session, mark who turned up. Members see Attended or Missed in their history.",
      },
      {
        title: "A reminder three hours before",
        body: "Everyone confirmed for a class gets a WhatsApp nudge before it starts. Once, automatically.",
      },
    ],
  },
  {
    id: "finance",
    title: "Finance",
    lede: "The numbers an owner actually wants, and a file for the bookkeeper.",
    color: "yellow",
    items: [
      {
        title: "Revenue you can read",
        body: "This month against last month, the last twelve months as a chart, split by plan or class and by cash versus online. Unpaid invoices in one number.",
      },
      {
        title: "Export for the accountant",
        body: "Every payment in a date range, or one line per month, as a CSV that opens cleanly in Excel. Paid only, or everything including voided and unpaid.",
      },
      {
        title: "Owner-only",
        body: "Staff run the desk and see members. Only the owner sees money, billing and settings.",
      },
    ],
  },
  {
    id: "notifications",
    title: "WhatsApp and email",
    lede: "Members hear from your gym, not from a stranger.",
    color: "green",
    items: [
      {
        title: "A number that works from day one",
        body: "Activation links, receipts, reminders and class updates go out over WhatsApp from the start, within your plan's monthly allowance.",
      },
      {
        title: "Or connect your own",
        body: "Add your gym's Fonnte token in Settings and messages come from your own number, with no monthly cap.",
      },
      {
        title: "Email too, if you want it",
        body: "Turn on email and every message also goes to the member's inbox. Every send is logged so you can see what went out and whether it arrived.",
      },
    ],
  },
  {
    id: "member-app",
    title: "What members see",
    lede: "A dashboard on their phone, no app store needed.",
    color: "blue",
    items: [
      {
        title: "Status at a glance",
        body: "Plan, days left, a big green Check in button. If they are expired, frozen or pending, it says so and what to do.",
      },
      {
        title: "Their own history",
        body: "Visits this month, current streak, total visits, a twelve-week heatmap and recent check-ins.",
      },
      {
        title: "A leaderboard, if you turn it on",
        body: "Most visits this month and longest streaks, with members shown as first name and last initial. Off by default; your call.",
      },
      {
        title: "Classes, renewals, their QR",
        body: "Book a class, renew by transfer, open their check-in QR, delete their own account. Everything a member needs without messaging the front desk.",
      },
    ],
  },
  {
    id: "public-page",
    title: "Your gym's public page",
    lede: "repstack.com/your-gym, ready to share.",
    color: "red",
    items: [
      {
        title: "A page you own",
        body: "Name, description, address and up to eight photos. Your classes are listed. A Join button when you are taking sign-ups, with a printable QR poster.",
      },
    ],
  },
  {
    id: "security",
    title: "Security and your data",
    lede: "Built so one gym can never see another, and so you can always leave with your data.",
    color: "yellow",
    items: [
      {
        title: "Each gym is sealed off",
        body: "Every query is scoped to your gym in the application and enforced again by the database. A bug cannot show another gym your members.",
      },
      {
        title: "Encrypted where it matters",
        body: "Member phone numbers and your WhatsApp credentials are encrypted at rest. Lists show masked numbers; full details only on a member's own page.",
      },
      {
        title: "Roles that match the desk",
        body: "The owner sees everything. Staff get check-in, members, classes and desk payments, and nothing about money or settings. Invite staff by link, deactivate them in one click.",
      },
      {
        title: "Your data is yours",
        body: "Export members and finances as CSV at any time. Erase a member on request. If you stop paying, your account is suspended, not deleted.",
      },
    ],
  },
];
