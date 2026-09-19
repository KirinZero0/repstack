import type { Metadata } from "next";
import localFont from "next/font/local";
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

export const metadata: Metadata = {
  title: "Iron Ledger",
  description: "Gym membership management",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        {theme.allowUserOverride && <ThemeToggle initial={theme.mode} />}
      </body>
    </html>
  );
}
