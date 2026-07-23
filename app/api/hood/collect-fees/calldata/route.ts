import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { encodeCollectFees } from "@/lib/chains/pons-fees";
import { PONS_LOCKER } from "@/lib/chains/pons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Calldata for `collectFees(token)` on the Pons locker, for the founder's
 * wallet to sign. Read-only and public: it encodes a call anyone is already
 * allowed to make (the locker itself enforces who may collect, and pays the
 * creator share to the recipient regardless of who triggers it). Served from
 * the server so the encoding stays in one tested place instead of being
 * rebuilt — and possibly mis-encoded — in the browser.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = (searchParams.get("project") || "loop-hood").slice(0, 64);
  const p = await getProject(key);
  if (!p || (p.chain ?? "solana") !== "hood" || !p.mint) {
    return NextResponse.json({ error: "not a live Hood project" }, { status: 404 });
  }
  return NextResponse.json(
    { to: PONS_LOCKER, data: encodeCollectFees(p.mint as string) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
