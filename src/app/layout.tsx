import type { Metadata } from "next";
import localFont from "next/font/local";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import "./backoffice.css";
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

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const DESCRIPTION =
  "Gym management software for independent gyms: memberships, QR door check-in, payments, classes and WhatsApp reminders in one dashboard. Know who trained and who paid.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Liftmora: gym membership, check-in and billing software",
  description: DESCRIPTION,
  applicationName: "Liftmora",
  keywords: ["gym management software", "gym membership software", "QR check-in gym", "aplikasi manajemen gym", "software gym Indonesia", "Liftmora"],
  openGraph: {
    type: "website",
    siteName: "Liftmora",
    title: "Liftmora: gym membership, check-in and billing software",
    description: DESCRIPTION,
    locale: "en_ID",
  },
  twitter: {
    card: "summary_large_image",
    title: "Liftmora: gym membership, check-in and billing software",
    description: DESCRIPTION,
  },
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
