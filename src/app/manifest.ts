import type { MetadataRoute } from "next";

/**
 * The web app manifest: what makes Liftmora installable ("Add to Home Screen"). It opens at /open,
 * which sends each person to their own home (staff to their gym's dashboard, members to /my, the
 * superadmin to the platform view, everyone else to the login), so one install works for everyone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Liftmora",
    short_name: "Liftmora",
    description: "Gym memberships, QR check-in, classes and payments in one app.",
    start_url: "/open",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c1014",
    theme_color: "#0c1014",
    categories: ["business", "fitness", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
