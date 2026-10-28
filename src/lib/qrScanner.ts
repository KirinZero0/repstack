import type { Html5Qrcode, Html5QrcodeCameraScanConfig } from "html5-qrcode";

/**
 * Builds a camera QR scanner tuned for the dense (~57×57 module) member and ticket QRs:
 * the browser's native BarcodeDetector where it exists (Android Chrome; others fall back to
 * the JS decoder), an HD back-camera stream so small modules stay sharp, and a scan box that
 * scales with the preview instead of a fixed 250px square.
 */
export async function createQrScanner(elementId: string): Promise<Html5Qrcode> {
  const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
  return new Html5Qrcode(elementId, {
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    useBarCodeDetectorIfSupported: true,
    verbose: false,
  });
}

export const QR_SCAN_CONFIG: Html5QrcodeCameraScanConfig = {
  fps: 15,
  qrbox: (viewfinderWidth, viewfinderHeight) => {
    const size = Math.max(150, Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.75));
    return { width: size, height: size };
  },
  // Replaces the start() camera argument, so the back-camera preference lives here too.
  videoConstraints: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
};
