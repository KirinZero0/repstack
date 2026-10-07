import type { Metadata } from "next";
import DemoApp from "@/components/demo/DemoApp";

export const metadata: Metadata = {
  title: "Demo · Liftmora",
  description: "Take a two-minute guided tour of Liftmora as a gym owner, using sample data.",
};

export default function DemoPage() {
  return <DemoApp contactUrl="/#pricing" />;
}
