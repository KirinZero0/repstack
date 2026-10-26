/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // The service worker must always be re-checked, or a fixed bug would linger on installed phones.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
