"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";
import { apiJoinWaitlist, IDEA_MAX } from "@/lib/waitlist-client";

// Capture pre-launch interest while public launches are closed. Needs one way to
// reach the person — the connected wallet counts, otherwise an email or X handle.
// The optional "what do you want to build?" is the most valuable field (product
// signal). Compact by default; `compact={false}` for the standalone page.
export function WaitlistForm({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const wallet = useWallet();
  const [email, setEmail] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { already: boolean }>(null);

  const hasContact = Boolean(wallet.address) || email.trim() !== "" || xHandle.trim() !== "";

  async function submit() {
    if (!hasContact || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiJoinWaitlist({
        wallet: wallet.address,
        email: email.trim() || null,
        xHandle: xHandle.trim() || null,
        idea: idea.trim() || null,
      });
      setDone(r);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-[12px] border border-accent-tint-border bg-accent-tint px-4 py-4 text-center">
        <div className="font-display font-semibold text-[15px] text-accent-text mb-1">
          {done.already ? "You're already on the list ✓" : "You're on the list ✓"}
        </div>
        <p className="text-[13px] text-muted leading-[1.5] m-0">
          We&apos;ll reach out the moment project creation opens. Early signups get first access.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${compact ? "gap-[10px]" : "gap-[14px]"}`}>
      {wallet.connected && wallet.address ? (
        <div className="text-[12.5px] text-muted">
          We&apos;ll tie your spot to <span className="font-mono text-ink">{shortAddr(wallet.address)}</span>.
          Add an email or X to get notified faster.
        </div>
      ) : (
        <div className="text-[12.5px] text-muted">
          Connect a wallet, or just drop an email / X handle.
        </div>
      )}

      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com (optional)"
        type="email"
        className="loop-input"
        aria-label="Email"
      />
      <input
        value={xHandle}
        onChange={(e) => setXHandle(e.target.value)}
        placeholder="@yourhandle (optional)"
        className="loop-input"
        aria-label="X handle"
      />
      <div>
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value.slice(0, IDEA_MAX))}
          placeholder="What would you want the agent to build for you? (optional)"
          rows={compact ? 2 : 3}
          className="loop-input resize-y"
          aria-label="What do you want to build?"
        />
        <div className="text-right text-[11px] text-faint mt-[2px]">{idea.length}/{IDEA_MAX}</div>
      </div>

      {error && <div className="text-[12.5px] text-warn">{error}</div>}

      <button
        onClick={submit}
        disabled={!hasContact || busy}
        className="font-display font-semibold text-[15px] py-[13px] rounded-[12px] bg-accent text-white hover:bg-accent-d transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? "Joining…" : "Join the waitlist"}
      </button>
      {!hasContact && (
        <div className="text-[11.5px] text-faint text-center -mt-1">
          Connect a wallet or add an email / X handle to join.
        </div>
      )}
    </div>
  );
}
