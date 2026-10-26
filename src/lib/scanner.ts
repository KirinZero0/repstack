import type { Html5Qrcode } from "html5-qrcode";

/** Plain-language reason a camera could not start, instead of the browser's raw message. */
export function describeCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const text = String(err instanceof Error ? err.message : err ?? "");
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "The camera only works on a secure (https) page.";
  }
  if (/NotAllowed|Permission/i.test(name + text)) {
    return "Camera access is blocked. Allow the camera for this site in your browser settings, then reload.";
  }
  if (/NotFound|Devices?NotFound|no camera/i.test(name + text)) {
    return "No camera was found on this device.";
  }
  if (/NotReadable|TrackStart|in use/i.test(name + text)) {
    return "The camera is busy. Close other apps or tabs using it, then reload.";
  }
  return text || "Failed to access camera";
}

// React dev mode mounts, unmounts and remounts effects; a new scanner must not start on the element
// until the previous one has fully stopped, or the old teardown rips the new video out of the page.
let pendingStop: Promise<void> = Promise.resolve();

/** Stops a scanner (even one still starting) and makes the next start wait for it. */
export function stopQrScanner(starting: Promise<Html5Qrcode>): void {
  pendingStop = starting
    .then(async (scanner) => {
      await scanner.stop();
      scanner.clear();
    })
    .catch(() => {});
}

/** Creates and starts a QR-only scanner tuned for phones; resolves to the scanner once the camera is live. */
export async function startQrScanner(
  elementId: string,
  onDecode: (text: string) => void,
): Promise<Html5Qrcode> {
  await pendingStop;
  const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
  const scanner = new Html5Qrcode(elementId, {
    verbose: false,
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    useBarCodeDetectorIfSupported: true,
  });
  await scanner.start(
    { facingMode: "environment" },
    {
      fps: 15,
      // No scan box: the whole frame is searched, so a code held close or off-centre still reads.
      videoConstraints: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    onDecode,
    undefined,
  );
  return scanner;
}

/** True when the running camera has a controllable torch. */
export function hasTorch(scanner: Html5Qrcode): boolean {
  try {
    return scanner.getRunningTrackCameraCapabilities().torchFeature().isSupported();
  } catch {
    return false;
  }
}

export async function setTorch(scanner: Html5Qrcode, on: boolean): Promise<void> {
  await scanner.getRunningTrackCameraCapabilities().torchFeature().apply(on);
}
