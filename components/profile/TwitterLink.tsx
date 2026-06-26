"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallet } from "@/lib/wallet";

// Twitter/X linking via Privy (Lot 2). Rendered ONLY when NEXT_PUBLIC_PRIVY_APP_ID
// is set (the parent gates it) — usePrivy needs the PrivyProvider context, which is
// a pass-through when unconfigured. Privy proves Twitter ownership; the wallet
// signature proves wallet ownership; the server (/api/profile/twitter) re-checks
// both before storing a verified handle. wallet-adapter stays the primary signer —
// Privy here is purely the social-link layer.
export function TwitterLink({
  wallet,
  currentHandle,
  onLinked,
}: {
  wallet: string;
  currentHandle: string | null;
  onLinked: () => void;
}) {
  const { ready, authenticated, user, login, linkTwitter, getAccessToken } = usePrivy();
  const walletApi = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accounts = (user?.linkedAccounts ?? []) as { type: string; username?: string | null }[];
  const privyTwitter = accounts.find((a) => a.type === "twitter_oauth")?.username?.replace(/^@/, "") ?? null;

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        setErr("No Privy session — try again.");
        return;
      }
      const proof = await walletApi.signProfileProof(wallet);
      if (!proof) {
        setErr("This wallet can't sign.");
        return;
      }
      const r = await fetch("/api/profile/twitter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, proof, accessToken: token }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "link failed");
        return;
      }
      onLinked();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "link failed");
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "font-mono text-[12px] px-3 h-[34px] rounded-[9px] border border-line-2 hover:bg-surface-2 transition-colors disabled:opacity-60 inline-flex items-center gap-[6px]";

  return (
    <div>
      {currentHandle && (
        <div className="text-[12px] text-pos font-mono mb-2">✓ linked: @{currentHandle}</div>
      )}
      {err && <div className="text-[12px] text-neg font-mono mb-2">{err}</div>}
      {!ready ? (
        <button className={btn} disabled>
          Loading…
        </button>
      ) : !authenticated ? (
        <button className={btn} onClick={() => login()}>
          Connect to link X
        </button>
      ) : !privyTwitter ? (
        <button className={btn} onClick={() => linkTwitter()}>
          Link X account
        </button>
      ) : (
        <button className={btn} onClick={save} disabled={busy}>
          {busy ? "Check your wallet…" : `Save @${privyTwitter} to profile`}
        </button>
      )}
    </div>
  );
}
