export type MemberStatus = "ACTIVE" | "PENDING_PAYMENT" | "EXPIRED" | "FROZEN";

export interface DemoMember {
  name: string;
  email: string;
  phone: string;
  plan: string;
  status: MemberStatus;
  expiresInDays: number | null;
}

export interface DemoPlan {
  id: string;
  name: string;
  days: number;
  price: number;
  onSale: boolean;
  members: number;
}

export interface DemoRequest {
  id: string;
  name: string;
  email: string;
  phone: string;
  plan: string;
  amount: number;
  submitted: string;
}

export const INITIAL_PLANS: DemoPlan[] = [
  { id: "p1", name: "Monthly", days: 30, price: 250000, onSale: true, members: 5 },
  { id: "p2", name: "Quarterly", days: 90, price: 650000, onSale: true, members: 2 },
  { id: "p3", name: "Annual", days: 365, price: 2500000, onSale: true, members: 1 },
  { id: "p4", name: "Student week pass", days: 7, price: 60000, onSale: false, members: 0 },
];

export const INITIAL_MEMBERS: DemoMember[] = [
  { name: "Sari Dewi", email: "sari.dewi@mail.com", phone: "0812 3400 4412", plan: "Annual", status: "ACTIVE", expiresInDays: 210 },
  { name: "Budi Santoso", email: "budi.santoso@mail.com", phone: "0813 5500 9087", plan: "Monthly", status: "ACTIVE", expiresInDays: 12 },
  { name: "Rina Putri", email: "rina.putri@mail.com", phone: "0857 2200 3351", plan: "Monthly", status: "ACTIVE", expiresInDays: 3 },
  { name: "Dimas Pratama", email: "dimas.pratama@mail.com", phone: "0812 7700 7720", plan: "Quarterly", status: "ACTIVE", expiresInDays: 51 },
  { name: "Andi Wijaya", email: "andi.wijaya@mail.com", phone: "0821 1100 1198", plan: "Monthly", status: "EXPIRED", expiresInDays: -6 },
  { name: "Maya Lestari", email: "maya.lestari@mail.com", phone: "0815 6600 6604", plan: "Quarterly", status: "ACTIVE", expiresInDays: 5 },
  { name: "Eko Nugroho", email: "eko.nugroho@mail.com", phone: "0838 4400 2275", plan: "Monthly", status: "FROZEN", expiresInDays: 20 },
  { name: "Lala Kusuma", email: "lala.kusuma@mail.com", phone: "0819 8800 8836", plan: "Monthly", status: "PENDING_PAYMENT", expiresInDays: null },
];

export const INITIAL_REQUESTS: DemoRequest[] = [
  { id: "r1", name: "Rizky Maulana", email: "rizky.maulana@mail.com", phone: "0813 5555 0101", plan: "Monthly", amount: 250000, submitted: "2 hours ago" },
  { id: "r2", name: "Putri Anggraini", email: "putri.anggraini@mail.com", phone: "0813 5555 0102", plan: "Quarterly", amount: 650000, submitted: "yesterday" },
];

export const REVENUE_MONTHS = [
  { label: "Apr", value: 2800000 },
  { label: "May", value: 3000000 },
  { label: "Jun", value: 3300000 },
  { label: "Jul", value: 3500000 },
  { label: "Aug", value: 6000000 },
  { label: "Sep", value: 6250000 },
];

export const REVENUE_BY_PLAN = [
  { label: "Annual", value: 5000000 },
  { label: "Monthly", value: 1250000 },
];

export const RECENT_PAYMENTS = [
  { member: "Maya Lestari", plan: "Quarterly", amount: 650000, status: "PAID", date: "17 Sep" },
  { member: "Budi Santoso", plan: "Monthly", amount: 250000, status: "PAID", date: "16 Sep" },
  { member: "Lala Kusuma", plan: "Monthly", amount: 250000, status: "PENDING", date: "15 Sep" },
  { member: "Sari Dewi", plan: "Annual", amount: 2500000, status: "PAID", date: "12 Sep" },
];

export interface DemoClass {
  id: string;
  name: string;
  coach: string;
  when: string;
  capacity: number;
  booked: number;
  price: number;
}

export const CLASSES: DemoClass[] = [
  { id: "c1", name: "Morning Yoga", coach: "Dewi", when: "Sat 31 Oct · 07:00", capacity: 12, booked: 9, price: 0 },
  { id: "c2", name: "HIIT Circuit", coach: "Arif", when: "Mon 2 Nov · 18:30", capacity: 16, booked: 16, price: 0 },
  { id: "c3", name: "Boxing Basics", coach: "Yudi", when: "Wed 4 Nov · 19:00", capacity: 10, booked: 4, price: 50000 },
];

export const ROSTER: { name: string; status: "Came" | "No-show" | "Booked" }[] = [
  { name: "Sari Dewi", status: "Came" },
  { name: "Maya Lestari", status: "Came" },
  { name: "Budi Santoso", status: "No-show" },
  { name: "Dimas Pratama", status: "Came" },
  { name: "Tari Wulandari (guest)", status: "Booked" },
];

export interface DemoGuest {
  id: string;
  name: string;
  phone: string;
  item: string;
  amount: number;
  hasProof: boolean;
}

export const GUEST_REQUESTS: DemoGuest[] = [
  { id: "g1", name: "Kevin Hartono", phone: "0813 5555 0144", item: "Day pass (Daily)", amount: 35000, hasProof: true },
  { id: "g2", name: "Tari Wulandari", phone: "0813 5555 0167", item: "Boxing Basics class", amount: 50000, hasProof: false },
];

export interface DemoFieldBooking {
  start: number;
  end: number;
  name: string;
  status: "Booked" | "Came" | "Blocked";
}

export const FIELDS: { id: string; name: string; sport: string; opens: number; closes: number; perHour: number; bookings: DemoFieldBooking[] }[] = [
  {
    id: "f1",
    name: "Court 1",
    sport: "Badminton",
    opens: 8 * 60,
    closes: 22 * 60,
    perHour: 60000,
    bookings: [
      { start: 9 * 60, end: 11 * 60, name: "Budi Santoso", status: "Came" },
      { start: 16 * 60, end: 18 * 60, name: "Dewi Lestari", status: "Booked" },
      { start: 19 * 60, end: 21 * 60, name: "Team Garuda", status: "Booked" },
    ],
  },
  {
    id: "f2",
    name: "Court 2",
    sport: "Badminton",
    opens: 8 * 60,
    closes: 22 * 60,
    perHour: 60000,
    bookings: [
      { start: 12 * 60, end: 14 * 60, name: "Net repair", status: "Blocked" },
      { start: 18 * 60, end: 19 * 60 + 30, name: "Rizki Pratama", status: "Booked" },
    ],
  },
  {
    id: "f3",
    name: "Futsal pitch",
    sport: "Futsal · per person",
    opens: 8 * 60,
    closes: 23 * 60,
    perHour: 25000,
    bookings: [{ start: 20 * 60, end: 22 * 60, name: "Kantor FC (10 people)", status: "Booked" }],
  },
];

export const IN_GYM_NOW = [
  { name: "Sari Dewi", since: "07:42" },
  { name: "Dimas Pratama", since: "08:05" },
  { name: "Lina Marlina (day pass)", since: "08:20" },
];

export const STAFF = [
  { name: "Ayu Pratiwi", email: "ayu@demogym.id", role: "Owner", can: "Everything, including finance, refunds, staff and settings" },
  { name: "Rudi Hartono", email: "rudi@demogym.id", role: "Staff", can: "Members, check-ins, classes, guests, fields. No finance or billing" },
  { name: "Nina Sari", email: "nina@demogym.id", role: "Staff", can: "Same as Rudi; each action is recorded under her name" },
];

export const REFUNDS = [
  { date: "14 Oct", to: "Budi Santoso", forWhat: "Field booking · Cash", reason: "Rained out, court leaked", amount: 120000 },
];
