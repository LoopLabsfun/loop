"use client";

import { useCallback, useEffect, useState } from "react";
import { useHoodWallet } from "@/lib/chains/hood-wallet";
import { PONS_LOCKER } from "@/lib/chains/pons";

// "Collect fees" for a Hood (Pons) project — the founder-facing half of the
// self-funding loop. The LP position is locked forever and accrues swap fees;
// `collectFees(token)` on the Pons locker pulls them and pays the creator share
// straight to the treasury (70%, protocol keeps 30% — read live, not assumed).
//
// The button only appears to the wallet that can actually collect (the
// treasury), so it never teases a control a visitor can't use. The signing is
// the founder's own wallet; the server only verifies the resulting tx and
// records it into the 30/65/5 ledger (/api/hood/collect-fees).

interface FeeStatus {
  token: string;
  treasury: string;
  feeRecipient: string;
  routedToTreasury: boolean;
  protocolPct: number | null;
  treasuryEth: number;
}

export function CollectHoodFees({ projectKey }: { projectKey: string }) {
  const hood = useHoodWallet();
  const [status, setStatus] = useState<FeeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/hood/collect-fees?project=${encodeURIComponent(projectKey)}`);
      if (!r.ok) return;
      setStatus((await r.json()) as FeeStatus);
    } catch {
      /* leave the last value — this panel is additive */
    }
  }, [projectKey]);

  useEffect(() => {
    void load();
    const iv = setInterval(() => void load(), 60_000);
    return () => clearInterval(iv);
  }, [load]);

  // Only the treasury can collect (it's the launch deployer + fee recipient).
  const isTreasury =
    Boolean(hood.address) &&
    Boolean(status?.treasury) &&
    hood.address!.toLowerCase() === status!.treasury.toLowerCase();
  if (!status || !isTreasury) return null;

  const collect = async () => {
    setErr(null);
    setNote(null);
    setBusy(true);
    try {
      if (hood.wrongChain) await hood.switchToHood();
      // Calldata comes from the server so the encoding lives in one tested
      // place (lib/chains/pons-fees) rather than being rebuilt in the browser.
      const sig = await hood.sendRawTx({
        to: PONS_LOCKER,
        data: await fetch(`/api/hood/collect-fees/calldata?project=${encodeURIComponent(projectKey)}`)
          .then((r) => r.json())
          .then((j: { data: string }) => j.data),
      });
      setNote("collecting… waiting for confirmation");
      // Record it: the server re-derives the amount from the chain and splits it.
      const r = await fetch("/api/hood/collect-fees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txHash: sig, project: projectKey }),
      });
      const j = (await r.json()) as { ok?: boolean; recordedEth?: number; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error || "could not record the collect");
      setNote(
        j.recordedEth
          ? `✓ ${j.recordedEth.toFixed(6)} ETH collected to the treasury and split`
          : "✓ collected (nothing had accrued yet)"
      );
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "collect failed");
    } finally {
      setBusy(false);
    }
  };

  const nothing = status.treasuryEth <= 0;
  return (
    <div className="bg-surface border border-line-2 rounded-[14px] px-4 py-3 mt-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">LP fees · Hood</div>
          <div className="font-mono text-[11.5px] text-faint mt-[2px]">
            {nothing
              ? "nothing accrued yet — fees build up as $LOOP trades"
              : `${status.treasuryEth.toFixed(6)} ETH ready`}
            {status.protocolPct != null && ` · you keep ${100 - status.protocolPct}%`}
          </div>
        </div>
        <button
          onClick={() => void collect()}
          disabled={busy || nothing}
          className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? "Collecting…" : "Collect fees"}
        </button>
      </div>
      {!status.routedToTreasury && (
        <p className="font-mono text-[11px] text-warn mt-2 mb-0">
          ⚠ fees route to {status.feeRecipient.slice(0, 6)}…{status.feeRecipient.slice(-4)}, not the treasury
        </p>
      )}
      {note && <p className="font-mono text-[11px] text-pos mt-2 mb-0">{note}</p>}
      {err && <p className="font-mono text-[11px] text-neg mt-2 mb-0">{err}</p>}
    </div>
  );
}
