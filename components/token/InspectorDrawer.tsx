"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { FollowButton } from "../FollowButton";
import { RichText } from "../RichText";
import {
  inspectKindMeta,
  useInspectorContext,
  type InspectItem,
} from "@/lib/inspector";
import {
  STATUS_LABEL,
  CATEGORY_LABEL,
  type AgentTask,
} from "@/lib/agent";
import type { WalletAction } from "@/lib/agent-data";
import type { FeedItem } from "@/lib/console";
import type { ChatMsg } from "@/lib/chat";
import type { InboxMessage, SocialPost } from "@/lib/agent";
import type { Holder, Project } from "@/lib/types";
import {
  explorerTx,
  explorerUrl,
  commitUrl,
  shortAddr,
} from "@/lib/format";

const fmtLoop = (n: number) => Math.round(n).toLocaleString("en-US");

// A vertical process timeline — the drawer's signature element. Each step is a
// dot + connector; `done` (shipped), `active` (current, pulses), `pending` (next).
// Reused by the chat Q&A and proposal lifecycle so "separate by process" reads
// the same everywhere.
type Step = { label: string; sub?: string; state: "done" | "active" | "pending" };
function ProcessTimeline({ steps }: { steps: Step[] }) {
  return (
    <div className="flex flex-col">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const dot =
          s.state === "done"
            ? "bg-pos border-pos"
            : s.state === "active"
              ? "bg-accent border-accent animate-pulseFast"
              : "bg-surface border-line-3";
        return (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`mt-[3px] w-[11px] h-[11px] rounded-full border-2 flex-none ${dot}`} />
              {!last && (
                <span
                  className={`w-[2px] flex-1 min-h-[20px] ${
                    s.state === "done" ? "bg-pos/40" : "bg-line-3"
                  }`}
                />
              )}
            </div>
            <div className={last ? "" : "pb-3"}>
              <div className={`text-[13px] leading-[1.4] ${s.state === "pending" ? "text-faint" : "text-ink"}`}>
                {s.label}
              </div>
              {s.sub && <div className="text-[11.5px] text-muted mt-[1px] leading-[1.4]">{s.sub}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The right-side detail drawer (operator mode). Renders the REAL depth of whatever
// element was clicked — no fetch, the payload is already in hand. Opens from the
// inspector context; ESC / backdrop / × close it.

const STATUS_DOT: Record<AgentTask["status"], string> = {
  shipped: "text-pos",
  building: "text-accent-text",
  todo: "text-muted",
  blocked: "text-neg",
  planned: "text-faint",
};

const DISP_LABEL: Record<WalletAction["disposition"], string> = {
  executed: "executed",
  simulated: "simulated",
  escalated: "escalated to founder",
  denied: "rejected",
};
const DISP_TONE: Record<WalletAction["disposition"], string> = {
  executed: "text-pos",
  simulated: "text-accent-text",
  escalated: "text-warn",
  denied: "text-neg",
};
const ACTION_LABEL: Record<WalletAction["kind"], string> = {
  buyback: "Buyback",
  burn: "Burn",
  airdrop: "Airdrop",
  bounty: "Bounty",
  swap: "Swap",
};

export function InspectorDrawer() {
  const ctx = useInspectorContext();
  const item = ctx?.item ?? null;
  // Memoized: the `?? (() => {})` fallback minted a new function every render,
  // so the ESC listener below tore down and re-subscribed on each one.
  const close = useMemo(() => ctx?.close ?? (() => {}), [ctx?.close]);

  // ESC closes the drawer.
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, close]);

  if (!ctx || !item) return null;
  const meta = inspectKindMeta(item);

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={meta.label}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[1px] animate-fadeInFast"
        onClick={close}
      />
      {/* Panel */}
      <div className="absolute top-0 right-0 h-full w-full max-w-[480px] bg-canvas border-l border-line-2 shadow-2xl animate-slideIn flex flex-col">
        {/* Header — glyph in a tinted tile + eyebrow label, on an accent wash. */}
        <div className="flex items-center justify-between gap-3 px-5 py-[14px] border-b border-line-2 bg-[linear-gradient(180deg,var(--accent-tint),transparent)]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-[30px] h-[30px] rounded-[9px] bg-accent-tint border border-accent-tint-border flex items-center justify-center font-mono text-[15px] text-accent-text flex-none">
              {meta.glyph}
            </span>
            <span className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
              {meta.label}
            </span>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="font-mono text-[15px] text-faint hover:text-ink transition-colors w-7 h-7 rounded-[8px] hover:bg-surface-2 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scroll-thin px-5 py-4">
          <DrawerBody item={item} project={ctx.project} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line-4 pt-[10px] mt-[10px] first:border-0 first:pt-0 first:mt-0">
      <div className="text-[10.5px] font-mono uppercase tracking-wide text-faint mb-[3px]">
        {label}
      </div>
      <div className="text-[13.5px] text-ink leading-[1.5]">{children}</div>
    </div>
  );
}

function DrawerBody({ item, project: p }: { item: InspectItem; project: Project }) {
  const net = p.network ?? "mainnet";

  switch (item.kind) {
    case "task":
      return <TaskBody task={item.task} />;
    case "action":
      return <ActionBody action={item.action} ticker={p.ticker} net={net} />;
    case "commit":
      return <CommitBody commit={item.commit} repo={p.repo} />;
    case "proposal":
      return <ProposalBody item={item.item} />;
    case "directive":
      return <DirectiveBody item={item.item} />;
    case "chat":
      return <ChatBody msg={item.msg} net={net} />;
    case "claim":
      return <ClaimBody claim={item.claim} net={net} />;
    case "email":
      return <EmailBody email={item.email} />;
    case "social":
      return <SocialBody post={item.post} />;
    case "holder":
      return <HolderBody holder={item.holder} net={net} />;
    case "summary":
      return <SummaryBody summary={item.summary} />;
    case "stat":
      return <StatBody stat={item.stat} />;
  }
}

function SummaryBody({
  summary: s,
}: {
  summary: { text: string; at?: string; shipped?: string[] };
}) {
  return (
    <>
      {s.at && (
        <div className="font-mono text-[11px] uppercase tracking-wide text-faint">
          {s.at}
        </div>
      )}
      <h3 className="font-display font-bold text-[17px] text-ink leading-[1.35] m-0 mt-1">
        {s.text || (s.shipped?.length ? `Shipped ${s.shipped.length}` : "No ships")}
      </h3>
      {s.shipped && s.shipped.length > 0 && (
        <Field label="Shipped">
          <ul className="flex flex-col gap-[4px]">
            {s.shipped.map((line, i) => (
              <li key={i} className="flex gap-[6px]">
                <span className="text-pos">✓</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Field>
      )}
      <Field label="What this is">
        The agent&apos;s honest summary of what it did — and what it didn&apos;t.
        Open a LIVE LOG task or a commit to see the underlying work.
      </Field>
    </>
  );
}

function StatBody({ stat: s }: { stat: { label: string; value: string; help?: string } }) {
  return (
    <>
      <div className="font-mono text-[11px] uppercase tracking-wide text-faint">
        {s.label}
      </div>
      <div className="font-display font-bold text-[28px] text-ink leading-[1.1] mt-1">
        {s.value}
      </div>
      {s.help && <Field label="What it means">{s.help}</Field>}
    </>
  );
}

function TaskBody({ task: t }: { task: AgentTask }) {
  return (
    <>
      <h3 className="font-display font-bold text-[18px] text-ink leading-[1.3] m-0">
        {t.title}
      </h3>
      <div className="flex items-center gap-2 mt-2">
        <span className={`font-mono text-[11.5px] ${STATUS_DOT[t.status]}`}>
          ● {STATUS_LABEL[t.status]}
        </span>
        <span className="font-mono text-[11px] text-muted bg-surface-2 border border-line-4 rounded-[5px] px-[6px] py-[1px]">
          {CATEGORY_LABEL[t.category]}
        </span>
        <span className="font-mono text-[11px] text-faint ml-auto">{t.at}</span>
      </div>
      {t.detail && (
        <Field label="What the agent is doing">
          <span className="whitespace-pre-wrap">{t.detail}</span>
        </Field>
      )}
      {t.lastOutcome && t.status !== "shipped" && (
        <Field label="Last attempt (episodic memory)">
          <span className="text-muted">↳ {t.lastOutcome}</span>
        </Field>
      )}
      <Field label="How this works">
        <span className="text-[12.5px] text-muted">
          The agent picks this up autonomously within its mandate. Blocked items
          escalate to the founder before anything irreversible.
        </span>
      </Field>
    </>
  );
}

function ActionBody({
  action: a,
  ticker,
  net,
}: {
  action: WalletAction;
  ticker: string;
  net: "mainnet" | "devnet";
}) {
  return (
    <>
      <h3 className="font-display font-bold text-[18px] text-ink m-0">
        {ACTION_LABEL[a.kind]}
        {a.amountSol > 0 && (
          <span className="font-mono text-[15px] text-muted"> · {a.amountSol} SOL</span>
        )}
        {a.kind === "buyback" && ticker && (
          <span className="font-mono text-[15px] text-muted"> → {ticker}</span>
        )}
      </h3>
      <div className="flex items-center gap-2 mt-2">
        <span className={`font-mono text-[11.5px] ${DISP_TONE[a.disposition]}`}>
          ● {DISP_LABEL[a.disposition]}
        </span>
        <span className="font-mono text-[11px] text-faint ml-auto">{a.at}</span>
      </div>
      {a.note && <Field label="Note">{a.note}</Field>}
      <Field label="On-chain">
        {a.txSig ? (
          <a
            href={explorerTx(a.txSig, net)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[12.5px] text-accent-text hover:text-accent-d transition-colors"
          >
            {shortAddr(a.txSig)} · view on explorer ↗
          </a>
        ) : (
          <span className="text-[12.5px] text-faint">
            {a.disposition === "simulated"
              ? "Simulated — no transaction was sent."
              : a.disposition === "escalated"
                ? "Awaiting founder sign-off — not yet on-chain."
                : a.disposition === "denied"
                  ? "Rejected by the guardrails — never executed."
                  : "No signature recorded."}
          </span>
        )}
      </Field>
    </>
  );
}

function CommitBody({
  commit: c,
  repo,
}: {
  commit: { hash: string; msg: string };
  repo: string;
}) {
  const url = commitUrl(repo, c.hash);
  return (
    <>
      <div className="font-mono text-[13px] text-accent-text">{c.hash}</div>
      <Field label="Message">
        <span className="whitespace-pre-wrap font-mono text-[12.5px]">{c.msg}</span>
      </Field>
      <Field label="Verify">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[12.5px] text-accent-text hover:text-accent-d transition-colors"
          >
            View this commit on GitHub ↗
          </a>
        ) : (
          <span className="text-[12.5px] text-faint">
            Public repo link unavailable.
          </span>
        )}
      </Field>
    </>
  );
}

const EXEC_DRAWER: Record<"todo" | "done" | "refused", { label: string; sub: string; cls: string }> = {
  done: { label: "✓ Done", sub: "Marked already shipped by the founder.", cls: "text-pos" },
  todo: { label: "→ To-do", sub: "Queued for the agent — it builds this next.", cls: "text-accent-text" },
  refused: { label: "✕ Refused", sub: "The founder overrode the passed vote.", cls: "text-neg" },
};

function ProposalBody({ item }: { item: FeedItem }) {
  const f = item.forVotes ?? 0;
  const a = item.againstVotes ?? 0;
  const q = item.quorum ?? 3;
  const total = f + a;
  const pct = Math.min(100, Math.round((total / q) * 100));
  const adopted = item.status === "adopted";
  const declined = item.status === "declined";
  const resolved = adopted || declined;
  const lifecycle: Step[] = [
    { label: "Proposed", sub: item.by ? `by ${item.by}` : undefined, state: "done" },
    {
      label: resolved ? "Holder vote closed" : "In holder vote",
      sub: `${f} for · ${a} against · quorum ${q}`,
      state: resolved ? "done" : "active",
    },
    {
      label: adopted ? "Adopted by vote" : declined ? "Declined by vote" : "Resolution",
      state: resolved ? "done" : "pending",
    },
    ...(adopted
      ? [
          item.exec
            ? { label: EXEC_DRAWER[item.exec].label, sub: EXEC_DRAWER[item.exec].sub, state: "done" as const }
            : { label: "Founder triage", sub: "awaiting Done / To-do / Refused", state: "active" as const },
        ]
      : []),
  ];
  return (
    <>
      <h3 className="font-display font-semibold text-[16px] text-ink leading-[1.4] m-0">
        {item.text}
      </h3>
      <div className="flex items-center gap-2 mt-2 font-mono text-[11px]">
        {resolved ? (
          <span className={adopted ? "text-pos" : "text-neg"}>
            ● {adopted ? "ADOPTED" : "DECLINED"}
          </span>
        ) : (
          <span className="text-accent-text">● OPEN</span>
        )}
        <span className="text-faint ml-auto">{item.at}</span>
      </div>
      <Field label="Votes">
        <div className="h-[6px] rounded-full bg-surface-3 overflow-hidden mb-2">
          <div
            className={`h-full ${resolved ? (adopted ? "bg-pos" : "bg-neg") : "bg-accent"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="font-mono text-[12px]">
          <span className="text-pos">{f} for</span> ·{" "}
          <span className="text-neg">{a} against</span> ·{" "}
          <span className="text-muted">quorum {q}</span>
        </div>
      </Field>
      {adopted && (
        <Field label="Founder triage">
          {item.exec ? (
            <div>
              <span className={`font-mono text-[12.5px] ${EXEC_DRAWER[item.exec].cls}`}>
                {EXEC_DRAWER[item.exec].label}
              </span>
              <div className="text-[12px] text-muted mt-[2px]">
                {EXEC_DRAWER[item.exec].sub}
              </div>
            </div>
          ) : (
            <span className="text-[12.5px] text-muted">
              Adopted by vote — awaiting the founder&apos;s triage
              (Done / To-do / Refused) in the feed.
            </span>
          )}
        </Field>
      )}
      <Field label="Lifecycle">
        <ProcessTimeline steps={lifecycle} />
      </Field>
      <Field label="How this resolves">
        <span className="text-[12.5px] text-muted">
          Proposals pass at a holder-proportional quorum (~1/10 of holders). The
          agent adopts or declines on its own once the bar is met; the founder then
          triages an adopted ask — done, queued for the agent, or refused.
        </span>
      </Field>
    </>
  );
}

function DirectiveBody({ item }: { item: FeedItem }) {
  return (
    <>
      <h3 className="font-display font-semibold text-[16px] text-ink leading-[1.4] m-0">
        {item.text}
      </h3>
      <div className="flex items-center gap-2 mt-2 font-mono text-[11px]">
        <span className={item.status === "applied" ? "text-pos" : "text-muted"}>
          ● {item.status === "applied" ? "APPLIED" : item.status === "declined" ? "DECLINED" : "QUEUED"}
        </span>
        <span className="text-faint ml-auto">{item.at}</span>
      </div>
      {item.by && (
        <Field label="Author">
          {item.by}{" "}
          {item.verified ? (
            <span className="text-pos">· verified ✓</span>
          ) : (
            <span className="text-faint">· unverified</span>
          )}
        </Field>
      )}
      <Field label="How the agent treats this">
        <span className="text-[12.5px] text-muted">
          {item.flagged
            ? "Flagged as a possible prompt-injection — caught and ignored. The agent has no tool to move funds and never acts on instructions embedded in directives."
            : "An untrusted suggestion the agent reads as data, not a command. It never moves funds or changes its mandate from a directive."}
        </span>
      </Field>
    </>
  );
}

// The agent Q&A — the founder's "read the answer in the panel" surface. The
// question is the heading, the agent's reply sits in a prominent answer card, and
// a process timeline separates payment → queue → answer.
function ChatBody({ msg: m, net }: { msg: ChatMsg; net: "mainnet" | "devnet" }) {
  const answered = m.status === "answered" && !!m.answer;
  const steps: Step[] = [
    {
      label: `Paid ${fmtLoop(m.loopPaid)} $LOOP`,
      sub:
        m.boost > 0
          ? `includes ${fmtLoop(m.boost)} boost · funds the treasury`
          : "to the project treasury",
      state: "done",
    },
    {
      label: answered ? "Queued" : "In the agent's queue",
      sub: answered
        ? undefined
        : m.boost > 0
          ? "boosted — answered before un-boosted questions"
          : "answered on the agent's next run",
      state: answered ? "done" : "active",
    },
    {
      label: answered ? "Answered" : "Awaiting answer",
      sub: answered ? m.at : undefined,
      state: answered ? "done" : "pending",
    },
  ];
  return (
    <>
      <div className="flex items-center gap-2 font-mono text-[11px]">
        <span className="text-muted">{shortAddr(m.wallet)}</span>
        {m.boost > 0 && <span className="text-accent-text">▲ {fmtLoop(m.boost)} boost</span>}
        <span className="text-faint ml-auto">{m.at}</span>
      </div>
      <h3 className="font-display font-bold text-[18px] text-ink leading-[1.3] m-0 mt-2">
        <RichText text={m.question} linkify />
      </h3>

      {answered ? (
        <div className="mt-3 rounded-[12px] border border-accent-tint-border bg-accent-tint px-4 py-3">
          <div className="font-mono text-[10px] tracking-[0.08em] text-accent-text uppercase mb-[5px]">
            ✦ Agent&apos;s answer
          </div>
          <div className="text-[14px] text-ink leading-[1.55] whitespace-pre-wrap">
            <RichText text={m.answer ?? ""} linkify />
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-[12px] border border-line-3 bg-surface-2 px-4 py-3 text-[12.5px] text-muted">
          ⏳ The agent hasn&apos;t answered yet — it replies on its next run
          {m.boost > 0 ? ", and your boost puts you ahead of the queue." : "."}
        </div>
      )}

      <Field label="Process">
        <ProcessTimeline steps={steps} />
      </Field>

      {m.txSig && (
        <Field label="Payment">
          <a
            href={explorerTx(m.txSig, net)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[12.5px] text-accent-text hover:text-accent-d transition-colors"
          >
            {shortAddr(m.txSig)} · view on explorer ↗
          </a>
        </Field>
      )}

      <Field label="What this is">
        <span className="text-[12.5px] text-muted">
          A paid question to the agent. Each message sends $LOOP to the treasury
          (funding the build); a boost jumps the answer queue. The agent answers
          factually about the project — it never moves funds from a chat.
        </span>
      </Field>
    </>
  );
}

// A real on-chain SOL inflow to the treasury — a pump.fun claim, fee route, or
// donation. The headline is the amount; the source + tx make it verifiable.
function ClaimBody({
  claim: c,
  net,
}: {
  claim: { sig: string; sol: number; at: number; source: string };
  net: "mainnet" | "devnet";
}) {
  const when = c.at ? new Date(c.at * 1000) : null;
  const sourceLabel = c.source
    ? c.source.replace(/_/g, " ").toLowerCase()
    : "on-chain";
  return (
    <>
      <div className="font-display font-bold text-[28px] text-pos leading-[1.1]">
        +{c.sol.toFixed(4)} SOL
      </div>
      <div className="flex items-center gap-2 mt-2 font-mono text-[11px]">
        <span className="text-accent-text">{sourceLabel}</span>
        <span className="text-faint ml-auto">
          {when ? when.toLocaleString() : ""}
        </span>
      </div>
      <Field label="What this is">
        <span className="text-[12.5px] text-muted">
          An on-chain SOL inflow to the project treasury — a pump.fun creator-fee
          claim, a trade-fee route, or a donation. Every inflow extends the
          agent&apos;s runway and funds the next build.
        </span>
      </Field>
      <Field label="On-chain">
        {c.sig ? (
          <a
            href={explorerTx(c.sig, net)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[12.5px] text-accent-text hover:text-accent-d transition-colors"
          >
            {shortAddr(c.sig)} · view on explorer ↗
          </a>
        ) : (
          <span className="text-[12.5px] text-faint">No signature recorded.</span>
        )}
      </Field>
    </>
  );
}

function EmailBody({ email: m }: { email: InboxMessage }) {
  return (
    <>
      <h3 className="font-display font-semibold text-[16px] text-ink leading-[1.4] m-0">
        {m.subject}
      </h3>
      <div className="flex items-center gap-2 mt-2 font-mono text-[11px]">
        <span className={m.direction === "out" ? "text-accent-text" : "text-pos"}>
          {m.direction === "out" ? "↗ sent" : "↘ received"}
        </span>
        <span className="text-faint ml-auto">{m.at}</span>
      </div>
      <Field label={m.direction === "out" ? "To" : "From"}>
        <span className="break-words">{m.party}</span>
      </Field>
      <Field label="Message">
        {/* Full body when stored (newlines preserved); legacy rows fall back to the
            short preview. break-words so long URLs/hashes wrap inside the panel. */}
        <span className="whitespace-pre-wrap break-words text-[12.5px] text-muted">
          {m.body || m.preview}
        </span>
      </Field>
    </>
  );
}

function SocialBody({ post: s }: { post: SocialPost }) {
  return (
    <>
      <div className="font-mono text-[11px] text-accent-text uppercase tracking-wide">
        {s.platform}
      </div>
      <Field label="Post">
        <span className="whitespace-pre-wrap">{s.text}</span>
      </Field>
      <div className="flex items-center gap-3 mt-3 font-mono text-[11.5px] text-muted">
        <span>♥ {s.likes}</span>
        <span>↩ {s.replies}</span>
        <span className="text-faint ml-auto">{s.at}</span>
      </div>
    </>
  );
}

function HolderBody({ holder: h, net }: { holder: Holder; net: "mainnet" | "devnet" }) {
  const title = h.loopName || h.name;
  return (
    <>
      {title && (
        <div className="flex items-center gap-[10px]">
          {h.loopAvatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={h.loopAvatar} alt="" className="w-[34px] h-[34px] rounded-[10px] object-cover border border-line-2 flex-none" />
          )}
          <h3 className="font-display font-semibold text-[16px] text-ink m-0">{title}</h3>
          {h.loopName && (
            <span className="font-mono text-[9.5px] px-[6px] py-[2px] rounded-[5px] bg-accent-tint text-accent-text border border-accent-tint-border">
              loop profile
            </span>
          )}
        </div>
      )}
      <Field label="Holds">
        <span className="font-mono text-[15px]">{(h.share * 100).toFixed(2)}%</span>{" "}
        <span className="text-[12.5px] text-muted">of supply</span>
      </Field>
      <Field label="Wallet">
        <a
          href={explorerUrl(h.address, net)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[12.5px] text-accent-text hover:text-accent-d transition-colors break-all"
        >
          {h.address} ↗
        </a>
      </Field>
      {/* A holder is a Loop identity — follow them, and link to their wallet-keyed
          profile, so the holder list, the token page, and profiles form one graph. */}
      <div className="mt-1 flex items-center gap-2">
        <FollowButton target={h.address} autoState size="sm" />
        <Link
          href={`/u/${h.address}`}
          className="inline-flex items-center gap-[6px] h-[34px] px-3 rounded-[10px] border border-line-2 text-[13px] hover:bg-surface-2 transition-colors"
        >
          View Loop profile →
        </Link>
      </div>
    </>
  );
}
