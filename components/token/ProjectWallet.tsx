"use client";

import { explorerUrl, explorerTx, shortAddr } from "@/lib/format";
import type { WalletAction } from "@/lib/agent-data";
import type { Project } from "@/lib/types";

// The project's agent wallet + its on-chain positions (buyback / burn / airdrop
// / bounty / swap). Reads structured rows from `agent_actions` (via getAgentState);
// honest empty state until the agent acts. The agent runs these within the
// guardrails — irreversible ones (burn/airdrop) escalate to the founder first.

const KIND_META: Record<
  WalletAction["kind"],
  { label: string; glyph: string; sign: "out" | "in" | "neutral" }
> = {
  buyback: { label: "Buyback", glyph: "▲", sign: "in" },
  burn: { label: "Burn", glyph: "🔥", sign: "out" },
  airdrop: { label: "Airdrop", glyph: "🎁", sign: "out" },
  bounty: { label: "Bounty", glyph: "◎", sign: "out" },
  swap: { label: "Swap", glyph: "⇄", sign: "neutral" },
};

const DISP_STYLE: Record<WalletAction["disposition"], string> = {
  executed: "text-pos border-pos",
  simulated: "text-accent-text border-accent-tint-border bg-accent-tint",
  escalated: "text-warn border-warn",
  denied: "text-neg border-neg",
};
const DISP_LABEL: Record<WalletAction["disposition"], string> = {
  executed: "executed",
  simulated: "simulated",
  escalated: "escalated",
  denied: "rejected",
};

export function ProjectWallet({
  project: p,
  actions = [],
}: {
  project: Project;
  actions?: WalletAction[];
}) {
  const wallet = p.agentWallet ?? null;
  const net = p.network ?? "mainnet";
  // Net SOL deployed by executed actions (buyback in, others out).
  const deployed = actions
    .filter((a) => a.disposition === "executed")
    .reduce((sum, a) => sum + a.amountSol, 0);

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] overflow-hidden">
      {/* Header — agent wallet identity */}
      <div className="px-5 py-[14px] border-b border-line-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className={`w-[7px] h-[7px] rounded-full ${wallet ? "bg-pos-bright animate-pulseFast" : "bg-faint"}`}
          />
          <span className="font-display font-semibold text-[15px]">
            Project Wallet
          </span>
        </div>
        {wallet ? (
          <a
            href={explorerUrl(wallet, net)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[12px] text-accent-text hover:text-accent-d transition-colors"
          >
            {shortAddr(wallet)} ↗
          </a>
        ) : (
          <span className="font-mono text-[11.5px] text-faint">
            not provisioned yet
          </span>
        )}
      </div>

      {/* Positions */}
      <div className="px-5 py-3 flex flex-col gap-[10px] max-h-[300px] overflow-y-auto scroll-thin">
        {actions.length === 0 ? (
          <div className="text-[12.5px] text-faint text-center py-6">
            No on-chain activity yet — buybacks, burns, airdrops and bounties the
            agent makes appear here. Irreversible ones are escalated to the
            founder first.
          </div>
        ) : (
          actions.map((a) => {
            const m = KIND_META[a.kind];
            return (
              <div
                key={a.id}
                className="flex items-start gap-3 rounded-[10px] border border-line-3 bg-surface px-3 py-[10px]"
              >
                <span
                  className="font-mono text-[13px] mt-[1px]"
                  aria-hidden
                >
                  {m.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display font-semibold text-[13.5px] text-ink">
                      {m.label}{" "}
                      <span
                        className={`font-mono text-[12px] ${m.sign === "in" ? "text-pos" : m.sign === "out" ? "text-muted" : "text-body"}`}
                      >
                        {a.amountSol > 0 ? `${a.amountSol} SOL` : ""}
                      </span>
                    </span>
                    <span
                      className={`font-mono text-[10px] px-[7px] py-[2px] rounded-[6px] border whitespace-nowrap bg-surface-2 ${DISP_STYLE[a.disposition]}`}
                    >
                      {DISP_LABEL[a.disposition]}
                    </span>
                  </div>
                  {a.note && (
                    <div className="text-[12px] text-muted mt-[2px]">{a.note}</div>
                  )}
                  <div className="flex items-center gap-2 mt-[3px]">
                    <span className="font-mono text-[10.5px] text-faint">{a.at}</span>
                    {a.txSig && (
                      <a
                        href={explorerTx(a.txSig, net)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10.5px] text-accent-text hover:text-accent-d transition-colors"
                      >
                        {shortAddr(a.txSig)} ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer — net deployed */}
      <div className="px-5 py-[11px] border-t border-line-4 flex items-center justify-between text-[12px]">
        <span className="text-faint">Net deployed (executed)</span>
        <span className="font-mono text-ink">{deployed.toFixed(2)} SOL</span>
      </div>
    </div>
  );
}
