import { del, put } from "@vercel/blob";

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

/** Best effort: removes a blob so storage doesn't leak. Failures are logged, never thrown. */
export async function deleteBlob(url: string): Promise<void> {
  if (isBlobMock() || url.startsWith(MOCK_BLOB_ORIGIN)) return;
  await del(url).catch((err) => console.error(`Could not delete blob ${url}`, err));
}
