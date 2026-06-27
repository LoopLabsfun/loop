import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LoopMark } from "../LoopMark";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { launchProjectAction } from "@/lib/actions";
import { launchesOpen, LAUNCHES_CLOSED_MESSAGE } from "@/lib/launch-config";
import { WaitlistForm } from "../WaitlistForm";
import { scoreReadiness, type ReadinessLevel } from "@/lib/agent-readiness";
import { explorerUrl, shortAddr } from "@/lib/format";
import {
  makeSplit,
  splitLabel,
  DEFAULT_SPLIT,
  MAX_FOUNDER_PCT,
} from "@/lib/fees";
import {
  SolanaIcon,
  GoogleIcon,
  XIcon,
  GitHubIcon,
  TelegramIcon,
} from "../AuthIcons";
import type { LaunchResult } from "@/lib/api";

const READINESS_STYLE: Record<ReadinessLevel, { dot: string; text: string }> = {
  strong: { dot: "bg-pos", text: "text-pos" },
  workable: { dot: "bg-accent-400", text: "text-accent-text" },
  early: { dot: "bg-warn", text: "text-warn" },
};

type Step = "form" | "stake" | "deploying" | "done";

const TITLES: Record<Step, string> = {
  form: "Launch a Project",
  stake: "Confirm & Launch",
  deploying: "Deploying…",
  done: "Project Live",
};

export function LaunchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const wallet = useWallet();
  const { network } = useNetwork();
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [prompt, setPrompt] = useState("");
  const [repo, setRepo] = useState("");
  const [guardrails, setGuardrails] = useState("");
  const [contentPolicy, setContentPolicy] = useState("");
  const [feeFounderPct, setFeeFounderPct] = useState(DEFAULT_SPLIT.founderPct);
  const [error, setError] = useState(false);
  const [deployLog, setDeployLog] = useState<string[]>([]);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Reset whenever it (re)opens.
  useEffect(() => {
    if (open) {
      setStep("form");
      setError(false);
      setDeployLog([]);
      setResult(null);
      setLaunchError(null);
      setFeeFounderPct(DEFAULT_SPLIT.founderPct);
      setGuardrails("");
      setContentPolicy("");
    }
  }, [open]);

  // Esc to close (except mid-deploy).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "deploying") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, onClose]);

  // All hooks must run on every render — keep useMemo above the early return,
  // or toggling `open` changes the hook count ("rendered more hooks…").
  const summaryName = name.trim() || "Open Source Cursor";
  const summaryTicker = "$" + (ticker.trim() || "OSCUR");
  const readiness = useMemo(() => scoreReadiness({ prompt, repo }), [prompt, repo]);
  const split = useMemo(() => makeSplit(feeFounderPct), [feeFounderPct]);

  if (!open) return null;

  const goStake = () => {
    if (!name.trim() || !ticker.trim()) {
      setError(true);
      return;
    }
    setStep("stake");
  };

  const startDeploy = async () => {
    // Ask the wallet to sign an ownership proof first. Rejection cancels the
    // launch; a wallet that can't signMessage returns null and proceeds.
    let proof = null;
    try {
      proof = await wallet.signLaunchProof(ticker);
    } catch {
      setLaunchError("Signature request rejected — launch cancelled.");
      return;
    }

    setStep("deploying");
    setDeployLog([
      proof ? `Ownership verified · ${wallet.label}` : `Launching · ${wallet.label}`,
    ]);
    const lines = [
      `Token ${summaryTicker.toUpperCase()} deployed on Pump.fun`,
      "Bonding-curve buy → treasury seeded",
      "Creator rewards connected to treasury",
    ];
    for (let i = 0; i < lines.length; i++) {
      await wait(700);
      setDeployLog((l) => [...l, lines[i]]);
    }
    try {
      const res = await launchProjectAction({
        name,
        ticker,
        prompt,
        repo,
        network,
        feeFounderPct,
        guardrails,
        contentPolicy,
        proof: proof ?? undefined,
      });
      setResult(res);
    } catch (e) {
      // Surface a validation/server error and return to the stake step.
      setLaunchError(
        e instanceof Error ? e.message : "Launch failed. Please try again."
      );
      setStep("stake");
      return;
    }
    await wait(700);
    setStep("done");
  };

  return (
    <div
      onClick={() => step !== "deploying" && onClose()}
      className="fixed inset-0 z-[100] bg-ink/45 backdrop-blur-[4px] flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] max-w-full bg-surface rounded-[20px] p-[30px] shadow-[0_24px_64px_-16px_rgba(22,19,26,0.3)] animate-fadeIn"
      >
        <div className="flex items-center justify-between mb-[22px]">
          <div className="font-display font-bold text-[19px]">{TITLES[step]}</div>
          <button
            onClick={onClose}
            className="w-[30px] h-[30px] rounded-[8px] border border-line-3 bg-surface text-muted hover:border-line-hover transition-colors text-[14px] leading-none"
          >
            ✕
          </button>
        </div>

        {step === "form" && !launchesOpen() && (
          <div className="flex flex-col gap-4 py-1">
            <div className="rounded-[12px] border border-line-3 bg-surface-2 px-4 py-4">
              <div className="font-display font-semibold text-[15px] text-ink mb-1">
                Launches open soon — get first access
              </div>
              <p className="text-[13.5px] text-muted leading-[1.55] m-0">
                {LAUNCHES_CLOSED_MESSAGE} Loop is proving the model on its own
                project, LOOP, first. Join the waitlist and you&apos;ll be first
                in line when project creation opens.
              </p>
            </div>
            {/* Turn the dead-end into capture: the people who clicked “Launch”
                are exactly the demand to capture while launches are closed. */}
            <WaitlistForm compact />
            <Link
              href="/token?p=loop"
              onClick={onClose}
              className="text-center font-display font-semibold text-[13.5px] py-[10px] rounded-[11px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
            >
              Meanwhile, watch LOOP build itself →
            </Link>
          </div>
        )}

        {step === "form" && launchesOpen() && (
          <div className="flex flex-col gap-[14px]">
            <Field label="Project name">
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(false);
                }}
                placeholder="Open Source Cursor"
                className="loop-input"
              />
            </Field>
            <Field label="Token ticker">
              <input
                value={ticker}
                onChange={(e) => {
                  setTicker(e.target.value.toUpperCase());
                  setError(false);
                }}
                placeholder="OSCUR"
                className="loop-input font-mono uppercase"
              />
            </Field>
            <Field label="Initial prompt — what should the agent build?">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Build an open-source AI IDE with autonomous refactoring…"
                rows={3}
                className="loop-input resize-y"
              />
            </Field>
            <Field label={<>GitHub repository <span className="text-ghost">(optional)</span></>}>
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="github.com/you/project"
                className="loop-input font-mono"
              />
            </Field>
            <Field label={<>Guardrails <span className="text-ghost">(optional · one per line, reread every cycle)</span></>}>
              <textarea
                value={guardrails}
                onChange={(e) => setGuardrails(e.target.value)}
                placeholder={"No paid ads without approval\nDon't ship breaking API changes\nKeep weekly spend under 2 SOL"}
                rows={3}
                className="loop-input resize-y"
              />
            </Field>
            <Field label={<>Content &amp; brand policy <span className="text-ghost">(optional · tone for posts, emails, copy)</span></>}>
              <textarea
                value={contentPolicy}
                onChange={(e) => setContentPolicy(e.target.value)}
                placeholder="Friendly but technical. No hype or price talk. Always link the repo."
                rows={2}
                className="loop-input resize-y"
              />
            </Field>
            <Field
              label={
                <span className="flex items-center justify-between">
                  <span>Fee split — founder ↔ agent</span>
                  <span className="font-mono text-ghost">
                    platform {split.platformPct}% fixed
                  </span>
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
              <p className="mt-[6px] text-[11.5px] text-faint leading-[1.45]">
                The agent&apos;s share funds its own wallet (compute + buyback /
                burn / bounties) so it self-funds. Default {DEFAULT_SPLIT.founderPct}/
                {DEFAULT_SPLIT.agentPct}/{DEFAULT_SPLIT.platformPct} is agent-favoured.
              </p>
            </Field>
            {error && (
              <div className="text-[12.5px] text-warn">
                Project name and ticker are required.
              </div>
            )}
            {(prompt.trim() || repo.trim()) && (
              <div className="bg-surface-2 rounded-[12px] p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-faint">Agent readiness</span>
                  <span
                    className={`inline-flex items-center gap-[6px] text-[12.5px] font-medium ${READINESS_STYLE[readiness.level].text}`}
                  >
                    <span
                      className={`w-[7px] h-[7px] rounded-full ${READINESS_STYLE[readiness.level].dot}`}
                    />
                    {readiness.headline} · {readiness.score}/4
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {readiness.conditions.map((c) => (
                    <span
                      key={c.key}
                      className={`text-[11.5px] ${c.met ? "text-body" : "text-faint"}`}
                      title={c.hint}
                    >
                      {c.met ? "✓" : "○"} {c.label}
                    </span>
                  ))}
                </div>
                {readiness.guidance && (
                  <div className="text-[12px] text-muted leading-[1.45]">
                    {readiness.guidance}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={goStake}
              className="mt-1 font-display font-semibold text-[15px] py-[13px] rounded-[12px] bg-accent text-white hover:bg-accent-d transition-colors"
            >
              Continue → Launch
            </button>
          </div>
        )}

        {step === "stake" && (
          <div className="flex flex-col gap-[14px]">
            <div className="bg-surface-2 rounded-[12px] p-4 flex flex-col gap-[10px]">
              <Row label="Project">
                <span className="font-medium">{summaryName}</span>
              </Row>
              <Row label="Token">
                <span className="font-mono text-accent-text">{summaryTicker}</span>
              </Row>
              <Row label="Launchpad">
                <span className="font-mono">Pump.fun</span>
              </Row>
              <Row label="Network">
                <span
                  className={`font-mono ${network === "devnet" ? "text-warn" : "text-pos"}`}
                >
                  {network}
                </span>
              </Row>
              <Row label="Fee split">
                <span className="font-mono" title="founder / agent / platform">
                  {splitLabel(split)}
                </span>
              </Row>
            </div>
            <div className="border border-accent-tint-border bg-accent-tint rounded-[12px] p-4">
              <div className="flex justify-between items-baseline mb-[6px]">
                <span className="font-display font-semibold text-[15px]">
                  Pay to launch
                </span>
                <span className="font-mono text-[16px] text-accent-text">
                  pump.fun curve
                </span>
              </div>
              <p className="text-[12.5px] text-muted leading-[1.5] m-0">
                No stake, no toll — open to anyone. Your bonding-curve buy seeds
                the project treasury; 5% of creator rewards route to the Loop
                treasury. Hold $LOOP for governance + a stronger default agent.
              </p>
            </div>
            {!wallet.connected ? (
              <div className="flex flex-col gap-[10px]">
                <button
                  onClick={wallet.connect}
                  className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[12px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
                >
                  Connect Wallet first
                </button>
                <div className="flex items-center justify-center gap-3 text-faint">
                  <span className="text-[11px]">Sign in with</span>
                  <SolanaIcon size={15} />
                  <GoogleIcon size={15} />
                  <XIcon size={13} />
                  <GitHubIcon size={15} />
                  <TelegramIcon size={15} />
                </div>
              </div>
            ) : (
              <button
                onClick={startDeploy}
                className="font-display font-semibold text-[15px] py-[13px] rounded-[12px] bg-accent text-white hover:bg-accent-d transition-colors"
              >
                Pay &amp; Launch
              </button>
            )}
            {launchError && (
              <div className="text-[12.5px] text-warn text-center">
                {launchError}
              </div>
            )}
            <button
              onClick={() => setStep("form")}
              className="text-[13px] py-[6px] text-faint hover:text-ink transition-colors"
            >
              ← Back
            </button>
          </div>
        )}

        {step === "deploying" && (
          <div className="flex flex-col gap-[10px] py-2">
            <div className="font-mono text-[13px] text-body flex flex-col gap-[9px]">
              {deployLog.map((line, i) => (
                <div key={i} className="animate-fadeInFast">
                  <span className="text-pos">✓</span> {line}
                </div>
              ))}
            </div>
            <div className="font-mono text-[13px] text-faint">
              <span className="animate-pulseTick">▮</span> working…
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col gap-[14px] text-center py-2">
            <div className="w-14 h-14 rounded-full bg-accent-tint mx-auto flex items-center justify-center">
              <LoopMark width={34} height={20} stroke="var(--accent)" />
            </div>
            <div>
              <div className="font-display font-bold text-[20px] mb-1">
                {summaryName} is live
              </div>
              <div className="text-[13.5px] text-muted">
                {summaryTicker} deployed · agent booting · treasury connected
              </div>
            </div>
            <div className="bg-surface-2 rounded-[12px] p-[14px] flex flex-col gap-2 font-mono text-[12.5px] text-left">
              <Row label="Launched by">
                <span>{wallet.label}</span>
              </Row>
              <Row label="Fee split">
                <span>{splitLabel(split)}</span>
              </Row>
              <Row label="Network">
                <span className={network === "devnet" ? "text-warn" : "text-pos"}>
                  {result?.network ?? network}
                </span>
              </Row>
              {result?.mint && (
                <Row label="Mint">
                  <a
                    href={explorerUrl(result.mint, result.network ?? network)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-text hover:text-accent-d transition-colors"
                  >
                    {shortAddr(result.mint)} ↗
                  </a>
                </Row>
              )}
              <Row label="Agent">
                <span className="text-pos">● first task queued</span>
              </Row>
            </div>
            {result?.key && (
              <Link
                href={`/token?p=${result.key}`}
                onClick={onClose}
                className="font-display font-semibold text-[15px] py-[13px] rounded-[12px] bg-accent text-white hover:bg-accent-d transition-colors"
              >
                View project →
              </Link>
            )}
            <button
              onClick={onClose}
              className="font-display font-semibold text-[15px] py-[13px] rounded-[12px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12.5px] text-muted mb-[6px]">{label}</label>
      {children}
    </div>
  );
}

function SplitStat({
  label,
  pct,
  tone,
}: {
  label: string;
  pct: number;
  tone: "ink" | "accent" | "faint";
}) {
  const color =
    tone === "accent" ? "text-accent-text" : tone === "faint" ? "text-faint" : "text-ink";
  return (
    <div className="bg-surface-2 rounded-[9px] px-2 py-[7px] text-center">
      <div className={`font-semibold ${color}`}>{pct}%</div>
      <div className="text-[10.5px] text-faint mt-[1px]">{label}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between text-[13.5px]">
      <span className="text-faint">{label}</span>
      {children}
    </div>
  );
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
