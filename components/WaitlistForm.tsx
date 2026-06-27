"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";
import { makeSplit, DEFAULT_SPLIT, MAX_FOUNDER_PCT } from "@/lib/fees";
import {
  apiJoinWaitlist,
  type WaitlistResult,
  NAME_MAX,
  TICKER_MAX,
  PROMPT_MAX,
  REPO_MAX,
} from "@/lib/waitlist-client";

// Pre-launch a project while public launches are closed. Mirrors the real launch
// form (name, ticker, prompt, repo, fee split, banner + token image) but saves a
// DRAFT instead of deploying — and opens a welcome DM from the official account so
// first contact happens on our own platform. Wallet-required: the submit is signed
// (wallet = identity) and the DM is wallet-to-wallet. `compact` tightens spacing
// for the launch modal; full for the standalone /waitlist page.
const MAX_IMAGE_MB = 2;

export function WaitlistForm({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const wallet = useWallet();
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [prompt, setPrompt] = useState("");
  const [repo, setRepo] = useState("");
  const [email, setEmail] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [feeFounderPct, setFeeFounderPct] = useState(DEFAULT_SPLIT.founderPct);
  const [banner, setBanner] = useState<File | null>(null);
  const [tokenImage, setTokenImage] = useState<File | null>(null);
  const [referrer, setReferrer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<WaitlistResult | null>(null);

  const split = useMemo(() => makeSplit(feeFounderPct), [feeFounderPct]);
  const canSubmit = name.trim() !== "" && ticker.trim() !== "";

  // Capture a referral from ?ref= (the Act 2 viral hook) without useSearchParams
  // (avoids the Next suspense-boundary requirement on this static page).
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setReferrer(ref);
  }, []);

  function pickImage(setter: (f: File | null) => void) {
    return (f: File | null) => {
      if (f && f.size > MAX_IMAGE_MB * 1024 * 1024) {
        setError(`Image must be under ${MAX_IMAGE_MB} MB.`);
        return;
      }
      setError(null);
      setter(f);
    };
  }

  async function submit() {
    if (!wallet.connected || !wallet.address) {
      wallet.connect();
      return;
    }
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const proof = await wallet.signWaitlistProof(wallet.address);
      if (!proof) {
        setError("This wallet can't sign messages — try Phantom or Solflare.");
        return;
      }
      const r = await apiJoinWaitlist(wallet.address, proof, {
        name: name.trim(),
        ticker: ticker.trim(),
        prompt: prompt.trim() || null,
        repo: repo.trim() || null,
        email: email.trim() || null,
        xHandle: xHandle.trim() || null,
        referrer,
        feeFounderPct,
        banner,
        tokenImage,
      });
      setDone(r);
      onDone?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong — try again.";
      setError(/reject|denied|cancel/i.test(msg) ? "Signature rejected — try again." : msg);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-[12px] border border-accent-tint-border bg-accent-tint px-4 py-4 text-center">
        <div className="font-display font-semibold text-[15px] text-accent-text mb-1">
          {done.already ? `${name.trim()} draft updated ✓` : `${name.trim()} is pre-launched ✓`}
        </div>
        {done.messaged ? (
          <p className="text-[13px] text-muted leading-[1.5] m-0">
            We just opened a DM on Loop —{" "}
            <a href="/messages" className="text-accent-text font-semibold underline-offset-2 hover:underline">
              check your messages
            </a>{" "}
            and tell the agent what to build first.
          </p>
        ) : (
          <p className="text-[13px] text-muted leading-[1.5] m-0">
            You&apos;re on the launch list — first in when the factory opens.
          </p>
        )}
      </div>
    );
  }

  // Wallet is identity here: you sign the pre-launch and the welcome DM is sent to
  // your wallet. So gate the form behind a connect.
  if (!wallet.connected || !wallet.address) {
    return (
      <div className="flex flex-col gap-[14px] text-center">
        <p className="text-[13px] text-muted leading-[1.55] m-0">
          Connect a wallet to draft your project — name it, set its token, tell the
          agent what to build. Your wallet is your spot in line.
        </p>
        <button
          onClick={() => wallet.connect()}
          className="font-display font-semibold text-[15px] py-[13px] rounded-[12px] bg-accent text-white hover:bg-accent-d transition-colors"
        >
          Connect wallet to pre-launch
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${compact ? "gap-[11px]" : "gap-[14px]"}`}>
      <div className="text-[12.5px] text-muted">
        Drafting as <span className="font-mono text-ink">{shortAddr(wallet.address)}</span>. Re-submit anytime to refine it.
      </div>

      <Field label="Project name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
          placeholder="Open Source Cursor"
          className="loop-input"
          aria-label="Project name"
        />
      </Field>

      <Field label="Token ticker">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, TICKER_MAX))}
          placeholder="OSCUR"
          className="loop-input font-mono uppercase"
          aria-label="Token ticker"
        />
      </Field>

      <div className="grid grid-cols-2 gap-[10px]">
        <ImagePicker
          label="Token image"
          file={tokenImage}
          onPick={pickImage(setTokenImage)}
          boxClass="h-[60px] w-[60px] rounded-full mx-auto"
        />
        <ImagePicker
          label="Banner"
          file={banner}
          onPick={pickImage(setBanner)}
          boxClass="h-[60px] w-full rounded-[10px]"
        />
      </div>

      <Field label="What should the agent build?">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
          placeholder="An open-source AI IDE with autonomous refactoring…"
          rows={compact ? 2 : 3}
          className="loop-input resize-y"
          aria-label="What should the agent build?"
        />
        <div className="text-right text-[11px] text-faint mt-[2px]">{prompt.length}/{PROMPT_MAX}</div>
      </Field>

      <Field
        label={
          <span className="flex items-center justify-between">
            <span>Fee split — founder ↔ agent</span>
            <span className="font-mono text-ghost">platform {split.platformPct}% fixed</span>
          </span>
        }
      >
        <input
          type="range"
          min={0}
          max={MAX_FOUNDER_PCT}
          step={1}
          value={feeFounderPct}
          onChange={(e) => setFeeFounderPct(Number(e.target.value))}
          className="w-full accent-[var(--accent)] cursor-pointer"
          aria-label="Founder fee share percentage"
        />
        <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[12px]">
          <SplitStat label="Founder" pct={split.founderPct} tone="ink" />
          <SplitStat label="Agent" pct={split.agentPct} tone="accent" />
          <SplitStat label="Platform" pct={split.platformPct} tone="faint" />
        </div>
      </Field>

      {!compact && (
        <>
          <Field label={<>GitHub repo <span className="text-ghost">(optional)</span></>}>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value.slice(0, REPO_MAX))}
              placeholder="github.com/you/project"
              className="loop-input font-mono"
              aria-label="GitHub repository"
            />
          </Field>
          <div className="grid grid-cols-2 gap-[10px]">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email (optional)"
              type="email"
              className="loop-input"
              aria-label="Email"
            />
            <input
              value={xHandle}
              onChange={(e) => setXHandle(e.target.value)}
              placeholder="@x (optional)"
              className="loop-input"
              aria-label="X handle"
            />
          </div>
        </>
      )}

      {error && <div className="text-[12.5px] text-warn">{error}</div>}

      <button
        onClick={submit}
        disabled={!canSubmit || busy}
        className="font-display font-semibold text-[15px] py-[13px] rounded-[12px] bg-accent text-white hover:bg-accent-d transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? "Signing…" : "Pre-launch my project"}
      </button>
      {!canSubmit && (
        <div className="text-[11.5px] text-faint text-center -mt-1">
          A name and ticker reserve your spot. Everything else you can refine later.
        </div>
      )}
    </div>
  );
}

function ImagePicker({
  label,
  file,
  onPick,
  boxClass,
}: {
  label: string;
  file: File | null;
  onPick: (f: File | null) => void;
  boxClass: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="flex flex-col gap-[5px]">
      <label className="block text-[12.5px] text-muted">{label} <span className="text-ghost">(optional)</span></label>
      <label
        className={`${boxClass} relative flex items-center justify-center overflow-hidden border border-dashed border-line-3 bg-surface-2 cursor-pointer hover:border-line-hover transition-colors`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={`${label} preview`} className="w-full h-full object-cover" />
        ) : (
          <span className="text-[11px] text-faint">+ image</span>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label={label}
        />
      </label>
      {file && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="text-[11px] text-faint hover:text-warn transition-colors text-left"
        >
          Remove
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12.5px] text-muted mb-[6px]">{label}</label>
      {children}
    </div>
  );
}

function SplitStat({ label, pct, tone }: { label: string; pct: number; tone: "ink" | "accent" | "faint" }) {
  const color = tone === "accent" ? "text-accent-text" : tone === "faint" ? "text-faint" : "text-ink";
  return (
    <div className="bg-surface-2 rounded-[9px] px-2 py-[7px] text-center">
      <div className={`font-semibold ${color}`}>{pct}%</div>
      <div className="text-[10.5px] text-faint mt-[1px]">{label}</div>
    </div>
  );
}
