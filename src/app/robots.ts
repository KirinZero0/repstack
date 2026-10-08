import type { MetadataRoute } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

/**
 * Public marketing pages and each gym's public profile are crawlable. Everything behind a login (back office,
 * member area, superadmin), the API, and one-time links stay out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          // Exact paths or folders: a bare "/my" would also hide any gym whose slug starts with "my".
          "/superadmin/",
          "/login$",
          "/forgot$",
          "/reset/",
          "/activate/",
          "/my/",
          "/my$",
          "/my-qr",
          "/check-in",
          // A gym's back office and member area: /<gym>/<page>. Its public pages are /<gym> and /<gym>/join.
          "/*/login",
          "/*/member-login",
          "/*/forgot",
          "/*/dashboard",
          "/*/members",
          "/*/staff",
          "/*/plans",
          "/*/finance",
          "/*/billing",
          "/*/settings",
          "/*/classes",
          "/*/checkin",
          "/*/checkin-station",
          "/*/join-poster",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
