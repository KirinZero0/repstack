import type { Metadata } from "next";
import localFont from "next/font/local";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { resolveTheme } from "@/lib/theme";
import ThemeToggle from "@/components/ThemeToggle";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Iron Ledger",
  description: "Memberships, door check-ins and billing for independent gyms. Know who trained and who paid.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = await resolveTheme();
  return (
    <html lang="en" data-theme={theme.mode}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${display.variable} antialiased`}
      >
        {children}
        {theme.allowUserOverride && <ThemeToggle initial={theme.mode} />}
      </body>
    </html>
  );
}
