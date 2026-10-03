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
