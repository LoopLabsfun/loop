import { useEffect, useState } from "react";
import Link from "next/link";
import { LoopMark } from "../LoopMark";
import { useWallet } from "@/lib/wallet";
import { launchProjectAction } from "@/lib/actions";
import type { LaunchResult } from "@/lib/api";

type Step = "form" | "stake" | "deploying" | "done";

const TITLES: Record<Step, string> = {
  form: "Launch a Project",
  stake: "Stake & Confirm",
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
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [prompt, setPrompt] = useState("");
  const [repo, setRepo] = useState("");
  const [error, setError] = useState(false);
  const [deployLog, setDeployLog] = useState<string[]>([]);
  const [result, setResult] = useState<LaunchResult | null>(null);

  // Reset whenever it (re)opens.
  useEffect(() => {
    if (open) {
      setStep("form");
      setError(false);
      setDeployLog([]);
      setResult(null);
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

  if (!open) return null;

  const summaryName = name.trim() || "Open Source Cursor";
  const summaryTicker = "$" + (ticker.trim() || "OSCUR");

  const goStake = () => {
    if (!name.trim() || !ticker.trim()) {
      setError(true);
      return;
    }
    setStep("stake");
  };

  const startDeploy = async () => {
    setStep("deploying");
    setDeployLog([`Launch signed · ${wallet.label}`]);
    const lines = [
      `Token ${summaryTicker.toUpperCase()} deployed on Pump.fun`,
      "1,000 LOOP staked & locked",
      "Creator rewards connected to treasury",
    ];
    for (let i = 0; i < lines.length; i++) {
      await wait(700);
      setDeployLog((l) => [...l, lines[i]]);
    }
    try {
      const res = await launchProjectAction({ name, ticker, prompt, repo });
      setResult(res);
    } catch {
      // Non-fatal for the prototype: the success screen still shows.
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

        {step === "form" && (
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
            {error && (
              <div className="text-[12.5px] text-warn">
                Project name and ticker are required.
              </div>
            )}
            <button
              onClick={goStake}
              className="mt-1 font-display font-semibold text-[15px] py-[13px] rounded-[12px] bg-accent text-white hover:bg-accent-d transition-colors"
            >
              Continue → Stake
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
            </div>
            <div className="border border-accent-tint-border bg-accent-tint rounded-[12px] p-4">
              <div className="flex justify-between items-baseline mb-[6px]">
                <span className="font-display font-semibold text-[15px]">
                  Stake to launch
                </span>
                <span className="font-mono text-[16px] text-accent-text">
                  1,000 LOOP
                </span>
              </div>
              <p className="text-[12.5px] text-muted leading-[1.5] m-0">
                Locked while the project is active. Refunded if you delete the
                project. 5% of creator rewards route to the Loop treasury.
              </p>
            </div>
            {!wallet.connected ? (
              <button
                onClick={wallet.connect}
                className="font-display font-semibold text-[15px] py-[13px] rounded-[12px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
              >
                Connect Wallet first
              </button>
            ) : (
              <button
                onClick={startDeploy}
                className="font-display font-semibold text-[15px] py-[13px] rounded-[12px] bg-accent text-white hover:bg-accent-d transition-colors"
              >
                Stake &amp; Launch
              </button>
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
              <Row label="Stake">
                <span>{result?.staked ?? "1,000 LOOP"} locked</span>
              </Row>
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
