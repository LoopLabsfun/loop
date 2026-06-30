import "server-only";
import { verifyAdminToken, ADMIN_COOKIE } from "./admin-session";
import { getProject } from "./queries";
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
 * wallet must EITHER equal the target project's own creator_wallet, OR be the
 * LOOP platform super-admin (LOOP's own creator_wallet) — the platform
 * operator's oversight account, which administers every project regardless of
 * who that individual project's own founder is. Each launched project gets its
 * own distinct creator_wallet (the per-project founder payout), so without this
 * the platform wallet would only ever administer "loop" itself.
 *
 * Defense-in-depth — the session is only minted after a founder-signature
 * check, but we re-bind to the live creator_wallet here so a stale token can't
 * outlive a creator change, and a project with no founder bolt set can never be
 * administered (unless the caller is the super-admin).
 */
export async function isFounder(
  req: Request,
  project: Pick<Project, "creatorWallet">
): Promise<boolean> {
  const w = adminWallet(req);
  if (!w) return false;
  if (project.creatorWallet && w === project.creatorWallet) return true;
  const loop = await getProject("loop");
  return Boolean(loop?.creatorWallet && w === loop.creatorWallet);
}
