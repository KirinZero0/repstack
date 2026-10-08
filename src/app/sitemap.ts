import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

/** The marketing pages plus every live gym's public profile and join page. Back-office pages are never listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/features`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/demo`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Suspended or cancelled gyms have no working page worth indexing. A database hiccup must not break the sitemap.
  const gyms = await prisma.gym
    .findMany({
      where: { subscriptionStatus: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
      select: { slug: true, createdAt: true },
    })
    .catch(() => []);

  for (const g of gyms) {
    pages.push({ url: `${SITE_URL}/${g.slug}`, lastModified: g.createdAt, changeFrequency: "monthly", priority: 0.5 });
  }
  return pages;
}
