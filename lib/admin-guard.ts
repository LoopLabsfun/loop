import "server-only";
import { verifyAdminToken, ADMIN_COOKIE } from "./admin-session";
import type { Project } from "./types";

/** Read one cookie value off a Request's Cookie header (no next/headers dep). */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

/** The verified admin wallet carried by the session cookie, or null. */
export function adminWallet(req: Request): string | null {
  return verifyAdminToken(readCookie(req, ADMIN_COOKIE))?.wallet ?? null;
}

/**
 * Founder gate for every admin request: the session cookie must be valid AND its
 * wallet must equal the project's creator_wallet. Defense-in-depth — the session
 * is only minted after a founder-signature check, but we re-bind to the live
 * creator_wallet here so a stale token can't outlive a creator change, and a
 * project with no founder bolt set can never be administered.
 */
export function isFounder(
  req: Request,
  project: Pick<Project, "creatorWallet">
): boolean {
  const w = adminWallet(req);
  return Boolean(w && project.creatorWallet && w === project.creatorWallet);
}
