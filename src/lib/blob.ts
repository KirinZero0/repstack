import { del, get, put } from "@vercel/blob";

/**
 * Dev/test only: with no BLOB_READ_WRITE_TOKEN outside production, uploads are faked so the
 * gym-photo flow can be exercised end to end without a Blob store. Same idea as WHATSAPP_MOCK /
 * PAYMENTS_MOCK. In production a missing token makes `put` throw, which callers surface as an error.
 */
export function isBlobMock(): boolean {
  return !process.env.BLOB_READ_WRITE_TOKEN && process.env.NODE_ENV !== "production";
}

export const MOCK_BLOB_ORIGIN = "https://mock-blob.local";

/** Uploads a publicly readable image (gym photos). Returns the URL to store. */
export async function putPublicImage(pathname: string, file: File | Blob, contentType: string): Promise<string> {
  if (isBlobMock()) {
    console.log(`[blob:mock] would upload ${pathname} (${contentType}, ${file.size} bytes)`);
    return `${MOCK_BLOB_ORIGIN}/${pathname}`;
  }
  const blob = await put(pathname, file, { access: "public", contentType, addRandomSuffix: true });
  return blob.url;
}

/** Uploads a privately-accessed file (join-request proof images). Returns the URL to store. */
export async function putPrivateFile(pathname: string, file: File | Blob, contentType: string): Promise<string> {
  if (isBlobMock()) {
    console.log(`[blob:mock] would upload ${pathname} (${contentType}, ${file.size} bytes)`);
    return `${MOCK_BLOB_ORIGIN}/${pathname}`;
  }
  const blob = await put(pathname, file, { access: "private", contentType, addRandomSuffix: true });
  return blob.url;
}

/** Fetches a private blob's bytes. Mocked uploads never hit real storage, so mock mode fakes a 1x1 image instead. */
export async function getPrivateFile(url: string): Promise<{ stream: ReadableStream; contentType: string } | null> {
  if (isBlobMock() || url.startsWith(MOCK_BLOB_ORIGIN)) {
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    return { stream: new Blob([pixel]).stream(), contentType: "image/png" };
  }
  const result = await get(url, { access: "private" }).catch(() => null);
  return result?.stream ? { stream: result.stream, contentType: result.blob.contentType } : null;
}

/** Best effort: removes a blob so storage doesn't leak. Failures are logged, never thrown. */
export async function deleteBlob(url: string): Promise<void> {
  if (isBlobMock() || url.startsWith(MOCK_BLOB_ORIGIN)) return;
  await del(url).catch((err) => console.error(`Could not delete blob ${url}`, err));
}
