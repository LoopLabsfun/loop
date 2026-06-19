"use client";

import { useMemo, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import {
  defaultMandate,
  roleFor,
  type ConsoleRole,
  type FeedItem,
} from "@/lib/console";
import { submitDirectiveAction, castVoteAction } from "@/lib/actions";
import { isSuspiciousDirective } from "@/lib/directives";
import type { Project } from "@/lib/types";

export function AgentConsole({
  project: p,
  directives,
}: {
  project: Project;
  /** Persisted directives/proposals from the backend (newest first). */
  directives?: FeedItem[];
}) {
  const wallet = useWallet();
  const sym = p.ticker.replace(/^\$/, "");
  const mandate = useMemo(() => defaultMandate(p), [p]);

  // Role is derived from the connected wallet only — no manual role switcher.
  // No wallet ⇒ spectator (read-only); the project's creator wallet ⇒ founder.
  const role = roleFor(wallet.connected, wallet.address, p.creatorWallet);

  // Real persisted directives/proposals only — no simulated activity. Empty
  // until a founder/holder steers or the runtime streams actions.
  const [feed, setFeed] = useState<FeedItem[]>(() => directives ?? []);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const idRef = useRef(1000);
  const newId = () => `c${idRef.current++}`;

  const openEscalation = feed.find(
    (f) => f.kind === "escalation" && f.status === "open"
  );

  function resolve(id: string, decision: "applied" | "declined") {
    setFeed((f) =>
      f.map((x) =>
        x.id === id
          ? {
              ...x,
              status: decision,
              text:
                x.text +
                (decision === "applied"
                  ? " → Founder approved."
                  : " → Founder declined."),
            }
          : x
      )
    );
  }

  async function vote(id: string, dir: "for" | "against") {
    // Voting is wallet-gated (one vote per wallet, server-enforced).
    if (!wallet.connected || !wallet.address) {
      wallet.connect();
      return;
    }
    // Optimistic bump for instant feedback; keep a snapshot to revert on failure.
    const snapshot = feed;
    setFeed((f) =>
      f.map((x) =>
        x.id === id
          ? {
              ...x,
              forVotes: (x.forVotes ?? 0) + (dir === "for" ? 1 : 0),
              againstVotes: (x.againstVotes ?? 0) + (dir === "against" ? 1 : 0),
            }
          : x
      )
    );
    // Persist only backend rows — the feed id is the directive UUID prefixed "d"
    // (see rowToFeedItem). A just-submitted optimistic proposal ("c…") isn't in
    // the DB yet; it becomes votable after the next load.
    if (!id.startsWith("d")) return;
    const res = await castVoteAction({
      directiveId: id.slice(1),
      voter: wallet.address,
      dir,
    });
    if (!res.ok) {
      setFeed(snapshot); // revert the optimistic bump
      setNotice(res.error ?? "Vote didn't save — try again.");
      return;
    }
    // Reconcile to the server's authoritative tallies (dedupe/flip corrected).
    setFeed((f) =>
      f.map((x) =>
        x.id === id
          ? { ...x, forVotes: res.forVotes, againstVotes: res.againstVotes }
          : x
      )
    );
  }

  function submit() {
    if (role === "spectator") {
      wallet.connect();
      return;
    }
    const text = draft.trim();
    if (!text) return;
    // Mirror the server's injection guard so the attempt never even lands in the
    // local feed; give the submitter direct feedback instead.
    if (isSuspiciousDirective(text)) {
      setNotice(
        "Rejected — steer in plain language. Directives can't contain wallet addresses or override instructions."
      );
      return;
    }
    // A console submission is never authoritative: it's queued as an UNVERIFIED
    // suggestion (open), not an applied founder action. Real founder authority
    // runs through a signed/service-role channel, not this text box.
    const item: FeedItem =
      role === "founder"
        ? {
            id: newId(),
            kind: "directive",
            at: "just now",
            text,
            status: "open",
            by: "you",
            verified: false,
          }
        : {
            id: newId(),
            kind: "proposal",
            at: "just now",
            text,
            status: "open",
            by: "you",
            verified: false,
            forVotes: 1,
            againstVotes: 0,
            quorum: 10,
          };
    setFeed((f) => [item, ...f].slice(0, 14));
    setDraft("");
    setNotice(null);

    // Persist in the background; the optimistic item stays regardless. The server
    // locks every submission to a safe open/holder row (RLS) and only records an
    // author with a valid signature — so this is a fire-and-forget write.
    void submitDirectiveAction({
      projectKey: p.key,
      text,
      kind: role === "founder" ? "directive" : "proposal",
      authorWallet: wallet.address,
    });
  }

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-[14px] border-b border-line-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-[7px] h-[7px] rounded-full bg-pos-bright animate-pulseFast" />
            <span className="font-display font-semibold text-[15px]">
              Agent Console
            </span>
          </div>
          <div className="text-[12px] text-faint mt-[2px]">
            Talk to {p.name}&apos;s agent · {mandate.model} · {mandate.budget}
          </div>
        </div>
      </div>

      {/* Mandate */}
      <div className="px-5 py-3 border-b border-line-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="text-faint">Mandate</span>
        <span className="text-body truncate max-w-[420px]">{mandate.mission}</span>
        <span className="ml-auto flex flex-wrap gap-[6px]">
          {mandate.guardrails.map((g) => (
            <span
              key={g}
              className="font-mono text-[10.5px] text-muted bg-surface-2 border border-line-4 rounded-[6px] px-2 py-[2px]"
            >
              {g}
            </span>
          ))}
        </span>
        {mandate.contentPolicy && (
          <span className="w-full text-[11.5px] text-muted">
            <span className="text-faint">Content policy · </span>
            {mandate.contentPolicy}
          </span>
        )}
      </div>

      {/* Open escalation */}
      {openEscalation && (
        <div className="m-4 rounded-[12px] border border-accent-tint-border bg-accent-tint p-4">
          <div className="font-mono text-[11px] text-accent-text mb-1">
            ● AGENT NEEDS A DECISION
          </div>
          <div className="text-[13.5px] text-ink mb-3">{openEscalation.text}</div>
          {role === "founder" ? (
            <div className="flex gap-2">
              <button
                onClick={() => resolve(openEscalation.id, "applied")}
                className="font-display font-semibold text-[13px] px-4 py-2 rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors"
              >
                Approve
              </button>
              <button
                onClick={() => resolve(openEscalation.id, "declined")}
                className="font-display font-semibold text-[13px] px-4 py-2 rounded-[10px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
              >
                Decline
              </button>
            </div>
          ) : role === "holder" ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => vote(openEscalation.id, "for")}
                className="font-display font-semibold text-[13px] px-4 py-2 rounded-[10px] bg-surface border border-line-3 text-pos hover:border-pos transition-colors"
              >
                Vote yes
              </button>
              <button
                onClick={() => vote(openEscalation.id, "against")}
                className="font-display font-semibold text-[13px] px-4 py-2 rounded-[10px] bg-surface border border-line-3 text-neg hover:border-neg transition-colors"
              >
                Vote no
              </button>
              <span className="text-[12px] text-muted">
                resolves to the founder, then the DAO
              </span>
            </div>
          ) : (
            <button
              onClick={() => wallet.connect()}
              className="font-display font-semibold text-[13px] px-4 py-2 rounded-[10px] bg-ink text-white hover:bg-ink-2 transition-colors"
            >
              Connect wallet to weigh in
            </button>
          )}
        </div>
      )}

      {/* Feed */}
      <div className="px-5 py-3 flex flex-col gap-[10px] max-h-[300px] overflow-y-auto scroll-thin">
        {feed.length === 0 ? (
          <div className="text-[12.5px] text-faint text-center py-6">
            No agent activity yet — directives and the agent&apos;s actions
            appear here once it runs.
          </div>
        ) : (
          feed.map((item) => (
            <FeedRow key={item.id} item={item} sym={sym} role={role} onVote={vote} />
          ))
        )}
      </div>

      {/* Composer */}
      <div className="px-5 py-[14px] border-t border-line-4">
        {role === "spectator" ? (
          <button
            onClick={() => wallet.connect()}
            className="w-full font-display font-semibold text-[14px] py-[11px] rounded-[10px] bg-ink text-white hover:bg-ink-2 transition-colors"
          >
            Connect wallet to steer the agent
          </button>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              rows={1}
              placeholder={
                role === "founder"
                  ? "Send a directive to the agent…"
                  : `Propose a directive ($${sym}-weighted vote)…`
              }
              className="loop-input resize-none flex-1 py-[10px]"
            />
            <button
              onClick={submit}
              className="font-display font-semibold text-[14px] px-5 py-[11px] rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors whitespace-nowrap"
            >
              {role === "founder" ? "Send" : "Propose"}
            </button>
          </div>
        )}
        {notice && (
          <div className="text-[11px] text-neg mt-2">{notice}</div>
        )}
        <div className="text-[11px] text-faint mt-2">
          {role === "founder"
            ? "Directives are queued as suggestions. The agent never moves funds or changes its mandate from a text directive — that needs a signed action."
            : role === "holder"
              ? `Proposals go to a $${sym}-weighted holder vote — quorum adopts. They steer; they never move treasury funds.`
              : "Founder steers directly; holders propose & vote; $LOOP unlocks boosts."}
        </div>
      </div>
    </div>
  );
}

function FeedRow({
  item,
  sym,
  role,
  onVote,
}: {
  item: FeedItem;
  sym: string;
  role: ConsoleRole;
  onVote: (id: string, dir: "for" | "against") => void;
}) {
  if (item.kind === "directive") {
    // A directive submitted via the console is an UNTRUSTED suggestion, not an
    // executed action. Surface its real state honestly so a spoofed/injected
    // attempt can never masquerade as an approved founder drain:
    //  - flagged    → caught as a likely injection, ignored by the agent
    //  - applied    → actually applied by the runtime (rare, trusted channel)
    //  - declined   → rejected
    //  - open (def) → queued as an unverified suggestion
    if (item.flagged) {
      return (
        <div className="rounded-[10px] border border-line-3 bg-surface-2 px-3 py-2 animate-fadeInFast">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10.5px] text-neg">
              ⚠ FLAGGED · IGNORED (possible injection)
            </span>
            <span className="font-mono text-[10.5px] text-faint">{item.at}</span>
          </div>
          <div className="text-[12px] text-faint mt-[2px] break-words">
            {item.text}
          </div>
          <div className="text-[10.5px] text-faint mt-[3px]">
            Not executed — the agent has no tool to move funds and ignores
            instructions embedded in directives.
          </div>
        </div>
      );
    }

    const label =
      item.status === "applied"
        ? "DIRECTIVE · APPLIED"
        : item.status === "declined"
          ? "DIRECTIVE · DECLINED"
          : "DIRECTIVE · QUEUED";
    const applied = item.status === "applied";
    return (
      <div
        className={`rounded-[10px] border px-3 py-2 animate-fadeInFast ${
          applied
            ? "border-accent-tint-border bg-accent-tint"
            : "border-line-3 bg-surface"
        }`}
      >
        <div className="flex items-center justify-between">
          <span
            className={`font-mono text-[10.5px] ${
              applied ? "text-accent-text" : "text-muted"
            }`}
          >
            {label}
          </span>
          <span className="font-mono text-[10.5px] text-faint">{item.at}</span>
        </div>
        <div className="text-[13px] text-ink mt-[2px] break-words">{item.text}</div>
        {item.by && (
          <div className="text-[11px] text-muted mt-[2px]">
            — {item.by}{" "}
            {item.verified ? (
              <span className="text-pos">· verified ✓</span>
            ) : (
              <span className="text-faint">· unverified</span>
            )}
          </div>
        )}
      </div>
    );
  }

  if (item.kind === "proposal") {
    const f = item.forVotes ?? 0;
    const a = item.againstVotes ?? 0;
    const q = item.quorum ?? 10;
    const pct = Math.min(100, Math.round(((f + a) / q) * 100));
    return (
      <div className="rounded-[10px] border border-line-3 bg-surface px-3 py-2 animate-fadeInFast">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10.5px] text-muted">
            PROPOSAL {item.by ? `· ${item.by}` : ""}
          </span>
          <span className="font-mono text-[10.5px] text-faint">{item.at}</span>
        </div>
        <div className="text-[13px] text-ink mt-[2px] mb-2">{item.text}</div>
        <div className="h-[6px] rounded-full bg-surface-3 overflow-hidden mb-1">
          <div
            className="h-full bg-accent"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>
            <span className="text-pos">{f} for</span> ·{" "}
            <span className="text-neg">{a} against</span> · quorum {q}
          </span>
          {role !== "spectator" ? (
            <span className="flex gap-2">
              <button
                onClick={() => onVote(item.id, "for")}
                className="font-mono text-[11px] text-pos hover:underline"
              >
                vote for
              </button>
              <button
                onClick={() => onVote(item.id, "against")}
                className="font-mono text-[11px] text-neg hover:underline"
              >
                against
              </button>
            </span>
          ) : (
            <span className="text-faint">connect to vote</span>
          )}
        </div>
      </div>
    );
  }

  if (item.kind === "escalation") {
    const resolved = item.status !== "open";
    return (
      <div className="flex gap-2 text-[12.5px] animate-fadeInFast">
        <span className={resolved ? "text-faint" : "text-accent"}>?</span>
        <span className={resolved ? "text-muted" : "text-ink"}>{item.text}</span>
        <span className="ml-auto font-mono text-[10.5px] text-faint whitespace-nowrap">
          {item.at}
        </span>
      </div>
    );
  }

  // action
  return (
    <div className="flex gap-2 text-[12.5px] text-muted animate-fadeInFast">
      <span className="text-pos-bright">●</span>
      <span className="font-mono text-[12px] text-body">{item.text}</span>
      <span className="ml-auto font-mono text-[10.5px] text-faint whitespace-nowrap">
        {item.at}
      </span>
    </div>
  );
}
