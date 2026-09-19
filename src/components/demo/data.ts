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

export const INITIAL_PLANS: DemoPlan[] = [
  { id: "p1", name: "Monthly", days: 30, price: 250000, onSale: true, members: 5 },
  { id: "p2", name: "Quarterly", days: 90, price: 650000, onSale: true, members: 2 },
  { id: "p3", name: "Annual", days: 365, price: 2500000, onSale: true, members: 1 },
  { id: "p4", name: "Student week pass", days: 7, price: 60000, onSale: false, members: 0 },
];

export const INITIAL_MEMBERS: DemoMember[] = [
  { name: "Sari Dewi", email: "s•••@mail.com", phone: "+62•••••4412", plan: "Annual", status: "ACTIVE", expiresInDays: 210 },
  { name: "Budi Santoso", email: "b•••••@mail.com", phone: "+62•••••9087", plan: "Monthly", status: "ACTIVE", expiresInDays: 12 },
  { name: "Rina Putri", email: "r••••@mail.com", phone: "+62•••••3351", plan: "Monthly", status: "ACTIVE", expiresInDays: 3 },
  { name: "Dimas Pratama", email: "d••••@mail.com", phone: "+62•••••7720", plan: "Quarterly", status: "ACTIVE", expiresInDays: 51 },
  { name: "Andi Wijaya", email: "a••••@mail.com", phone: "+62•••••1198", plan: "Monthly", status: "EXPIRED", expiresInDays: -6 },
  { name: "Maya Lestari", email: "m••••@mail.com", phone: "+62•••••6604", plan: "Quarterly", status: "ACTIVE", expiresInDays: 5 },
  { name: "Eko Nugroho", email: "e•••@mail.com", phone: "+62•••••2275", plan: "Monthly", status: "FROZEN", expiresInDays: 20 },
  { name: "Lala Kusuma", email: "l•••@mail.com", phone: "+62•••••8836", plan: "Monthly", status: "PENDING_PAYMENT", expiresInDays: null },
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
