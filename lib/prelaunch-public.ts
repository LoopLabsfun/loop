import "server-only";
import { supabaseAdmin } from "./supabase";
import { totalRaised, backerCount, type Contribution } from "./prefunding";

// PUBLIC pre-launch board data — the curated (whitelisted) projects opening soon,
// with their real pre-funding (the "vote with SOL" social proof). Service-role read
// returning ONLY safe public fields: never the proposer's wallet/email. The
// project_wallet IS returned — it's a public deposit address backers send SOL to.

export interface PublicPrelaunch {
  name: string;
  ticker: string;
  pitch: string | null;
  tokenImageUrl: string | null;
  bannerUrl: string | null;
  /** Public deposit address — back this launch by sending SOL here (refundable). */
  projectWallet: string | null;
  /** SOL currently backing it (confirmed contributions). */
  totalSol: number;
  /** Distinct backers. */
  backers: number;
}

/** Curated pre-launches for the home board (newest-curated first). Best-effort: a
 *  cold/unconfigured backend returns []. */
export async function getPublicPrelaunches(limit = 12): Promise<PublicPrelaunch[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const { data } = await sb
    .from("launch_waitlist")
    .select("wallet,name,ticker,prompt,token_image_url,banner_url,project_wallet,status,updated_at")
    .eq("status", "whitelisted")
    .not("name", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Record<string, unknown>[];
  if (!rows.length) return [];

  // Funding for these drafts in one query, grouped by draft wallet.
  const wallets = rows.map((r) => r.wallet as string);
  const { data: contribs } = await sb
    .from("prelaunch_contributions")
    .select("draft_wallet, contributor_wallet, amount_sol, tx_sig, status")
    .in("draft_wallet", wallets);
  const byDraft = new Map<string, Contribution[]>();
  for (const c of (contribs ?? []) as Record<string, unknown>[]) {
    const k = c.draft_wallet as string;
    const arr = byDraft.get(k) ?? [];
    arr.push({
      contributorWallet: c.contributor_wallet as string,
      amountSol: Number(c.amount_sol),
      txSig: c.tx_sig as string,
      status: (c.status as string) ?? "confirmed",
    });
    byDraft.set(k, arr);
  }

  return rows.map((r) => {
    const ledger = byDraft.get(r.wallet as string) ?? [];
    return {
      name: r.name as string,
      ticker: (r.ticker as string) ?? "",
      pitch: (r.prompt as string) ?? null,
      tokenImageUrl: (r.token_image_url as string) ?? null,
      bannerUrl: (r.banner_url as string) ?? null,
      projectWallet: (r.project_wallet as string) ?? null,
      totalSol: totalRaised(ledger),
      backers: backerCount(ledger),
    };
  });
}
