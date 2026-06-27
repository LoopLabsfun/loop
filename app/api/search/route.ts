import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getProjects } from "@/lib/queries";
import { searchPeople } from "@/lib/social";
import { isSolanaAddress } from "@/lib/api-guards";
import { verifyUserToken, USER_COOKIE } from "@/lib/user-session";

// GET /api/search?q= → matching projects + people. Projects are filtered in
// memory (the set is small); people come from a profiles ilike. A pasted wallet
// address resolves straight to its profile. Viewer (from the session cookie, if
// any) seeds the "you follow" flag on people results.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ projects: [], people: [] });
  const viewer = verifyUserToken(cookies().get(USER_COOKIE)?.value)?.wallet ?? null;

  const lc = q.toLowerCase();
  const [allProjects, people] = await Promise.all([getProjects(), searchPeople(q, viewer)]);
  const projects = allProjects
    .filter((p) => p.name.toLowerCase().includes(lc) || p.ticker.toLowerCase().includes(lc) || p.key.toLowerCase().includes(lc))
    .slice(0, 8)
    .map((p) => ({ key: p.key, name: p.name, ticker: p.ticker, marketCap: p.marketCap, official: p.official }));

  // A pasted wallet with no profile still resolves to its (empty) profile page.
  if (isSolanaAddress(q) && !people.some((u) => u.wallet === q)) {
    people.unshift({ wallet: q, displayName: null, avatarUrl: null, youFollow: false });
  }
  return NextResponse.json({ projects, people });
}
