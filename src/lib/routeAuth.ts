import { NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "./session";

/**
 * The gym-scoped session for an API route, or the error response to return straight away. Same
 * checks and status codes every tenant route uses (requireTenantSession is the single choke point).
 * With `ownerOnly`, a staff account gets a 403 instead.
 */
export async function tenantOrResponse(slug: string, opts: { ownerOnly?: string } = {}) {
  try {
    const ctx = await requireTenantSession(slug);
    if (opts.ownerOnly && ctx.session.role !== "OWNER") {
      return { response: NextResponse.json({ error: opts.ownerOnly }, { status: 403 }) } as const;
    }
    return { ctx } as const;
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return { response: NextResponse.json({ error: err.message }, { status }) } as const;
    }
    throw err;
  }
}
