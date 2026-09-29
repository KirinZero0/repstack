import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * A gym's pages moved from /g/[slug]/... to /[slug]/... (dropped the redundant /g/), and its API
 * routes from /api/g/[slug]/... to /api/[slug]/.... This keeps any already-shared, bookmarked, or
 * cached-in-an-old-page-load link working, page or API alike, permanently. 308 keeps the method
 * and body, so a POST to an old API URL still works, not just GET page links.
 */
export function middleware(req: NextRequest) {
  const rest = req.nextUrl.pathname.replace(/^(\/api)?\/g\//, "$1/");
  // Build the target from a clone and only set pathname, never re-parse the string as a URL — a
  // path like "/g//evil.com/x" would strip down to "//evil.com/x", which new URL() (or a template
  // string handed to it) reads as protocol-relative and redirects off-site. Setting .pathname can't
  // do that: it's always taken as a path on this same origin, whatever it starts with.
  const url = req.nextUrl.clone();
  url.pathname = rest;
  return NextResponse.redirect(url, 308);
}

export const config = { matcher: ["/g/:path*", "/api/g/:path*"] };
