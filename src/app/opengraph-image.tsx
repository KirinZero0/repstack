import { ImageResponse } from "next/og";

export const alt = "Liftmora: gym membership, check-in and billing software";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Rendered per request, not at build time, so a rendering problem can never fail a deploy.
export const dynamic = "force-dynamic";

/** The preview card shown when a Liftmora link is shared on WhatsApp, Instagram, LinkedIn and so on. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 90px",
          background: "#0c1014",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              width: 92,
              height: 92,
              borderRadius: 92,
              border: "12px solid #e8b923",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ width: 22, height: 22, borderRadius: 22, background: "#e8b923" }} />
          </div>
          <div style={{ fontSize: 84, fontWeight: 700 }}>Liftmora</div>
        </div>
        <div style={{ marginTop: 44, fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>Know who trained. Know who paid.</div>
        <div style={{ marginTop: 28, fontSize: 32, color: "#a3a3a3" }}>
          Memberships, QR check-in, payments and classes for independent gyms.
        </div>
      </div>
    ),
    size,
  );
}
