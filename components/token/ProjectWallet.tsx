"use client";

import { explorerUrl, explorerTx, shortAddr } from "@/lib/format";
import { useInspector } from "@/lib/inspector";
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
  agentSol,
}: {
  project: Project;
  actions?: WalletAction[];
  /** Live on-chain SOL balance of the agent wallet, or null/undefined if unknown. */
  agentSol?: number | null;
}) {
  const { inspect } = useInspector();
  const wallet = p.agentWallet ?? null;
  const net = p.network ?? "mainnet";
  // Net SOL deployed by executed actions (buyback in, others out).
  const deployed = actions
    .filter((a) => a.disposition === "executed")
    .reduce((sum, a) => sum + a.amountSol, 0);
  // Irreversible actions (burn/airdrop) that are queued for founder sign-off.
  const pendingSignOff = actions.filter(
    (a) => a.disposition === "escalated",
  ).length;
  // Per-kind breakdown of executed actions for the at-a-glance summary row.
  const KIND_ORDER: WalletAction["kind"][] = [
    "buyback",
    "burn",
    "airdrop",
    "bounty",
    "swap",
  ];
  const kindTotals = new Map<
    WalletAction["kind"],
    { count: number; sol: number }
  >();
  for (const a of actions.filter((a) => a.disposition === "executed")) {
    const prev = kindTotals.get(a.kind) ?? { count: 0, sol: 0 };
    kindTotals.set(a.kind, {
      count: prev.count + 1,
      sol: prev.sol + a.amountSol,
    });
  }

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
          <div className="flex items-center gap-2">
            {typeof agentSol === "number" && (
              <span
                className="font-mono text-[12px] text-ink"
                title="Live on-chain balance of the agent wallet"
              >
                {agentSol.toFixed(2)} SOL
              </span>
            )}
            <a
              href={explorerUrl(wallet, net)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[12px] text-accent-text hover:text-accent-d transition-colors"
            >
              {shortAddr(wallet)} ↗
            </a>
          </div>
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
                role="button"
                tabIndex={0}
                onClick={() => inspect({ kind: "action", action: a })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") inspect({ kind: "action", action: a });
                }}
                className="flex items-start gap-3 rounded-[10px] border border-line-3 bg-surface px-3 py-[10px] cursor-pointer hover:border-line-hover transition-colors"
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
                      {/* A buyback always buys the project's OWN token — name it
                          so the row says what was bought, not just how much SOL. */}
                      {a.kind === "buyback" && p.ticker && (
                        <span className="font-mono text-[12px] text-muted">
                          {" "}→ {p.ticker}
                        </span>
                      )}
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
                        onClick={(e) => e.stopPropagation()}
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

      {/* Per-kind executed summary — compact at-a-glance breakdown by action type */}
      {kindTotals.size > 0 && (
        <div className="px-5 py-[10px] border-t border-line-4 flex flex-wrap gap-x-4 gap-y-[6px]">
          {KIND_ORDER.filter((k) => kindTotals.has(k)).map((k) => {
            const m = KIND_META[k];
            const t = kindTotals.get(k)!;
            return (
              <span key={k} className="text-[11.5px] text-muted">
                <span className="font-mono mr-[3px]">{m.glyph}</span>
                {m.label}
                <span className="font-mono text-faint ml-[4px]">
                  ×{t.count}
                </span>
                {t.sol > 0 && (
                  <span className="font-mono text-ink ml-[4px]">
                    {t.sol.toFixed(2)} SOL
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Footer — net deployed + pending sign-offs */}
      <div className="px-5 py-[11px] border-t border-line-4 flex items-center justify-between text-[12px]">
        <span className="text-faint">
          Net deployed (executed)
          {pendingSignOff > 0 && (
            <span className="text-warn ml-1">
              · {pendingSignOff} awaiting sign-off
            </span>
          )}
        </span>
        <span className="font-mono text-ink">{deployed.toFixed(2)} SOL</span>
      </div>
    </div>
  );
}
