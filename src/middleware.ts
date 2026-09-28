import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * A gym's pages moved from /g/[slug]/... to /[slug]/... (dropped the redundant /g/), and its API
 * routes from /api/g/[slug]/... to /api/[slug]/.... This keeps any already-shared, bookmarked, or
 * cached-in-an-old-page-load link working, page or API alike, permanently. 308 keeps the method
 * and body, so a POST to an old API URL still works, not just GET page links.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const rest = pathname.replace(/^(\/api)?\/g\//, "$1/");
  const url = new URL(`${rest}${search}`, req.url);
  return NextResponse.redirect(url, 308);
}

export const config = { matcher: ["/g/:path*", "/api/g/:path*"] };
