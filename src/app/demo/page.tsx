import type { Metadata } from "next";
import DemoApp from "@/components/demo/DemoApp";

export const metadata: Metadata = {
  title: "Demo · Iron Ledger",
  description: "Take a two-minute guided tour of Iron Ledger as a gym owner, using sample data.",
};

export default function DemoPage() {
  const contactUrl = process.env.NEXT_PUBLIC_CONTACT_URL || "/#login";
  return <DemoApp contactUrl={contactUrl} />;
}
