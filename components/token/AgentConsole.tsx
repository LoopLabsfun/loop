"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { nowStamp } from "@/lib/format";
import {
  ACTION_POOL,
  ESCALATION_POOL,
  defaultMandate,
  roleFor,
  seedFeed,
  type ConsoleRole,
  type FeedItem,
} from "@/lib/console";
import type { Project } from "@/lib/types";

const ROLES: ConsoleRole[] = ["spectator", "holder", "founder"];
const ROLE_LABEL: Record<ConsoleRole, string> = {
  spectator: "Spectator",
  holder: "Holder",
  founder: "Founder",
};

export function AgentConsole({ project: p }: { project: Project }) {
  const wallet = useWallet();
  const sym = p.ticker.replace(/^\$/, "");
  const mandate = useMemo(() => defaultMandate(p), [p]);

  const defaultRole = roleFor(wallet.connected, wallet.address, p.creatorWallet);
  const [override, setOverride] = useState<ConsoleRole | null>(null);
  const role = override ?? defaultRole;

  const [feed, setFeed] = useState<FeedItem[]>(() => seedFeed(p));
  const [draft, setDraft] = useState("");
  const idRef = useRef(1000);
  const newId = () => `c${idRef.current++}`;

  // Live agent activity: append an action every ~6s; occasionally a new
  // escalation if none is open.
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setFeed((f) => {
        const hasOpen = f.some(
          (x) => x.kind === "escalation" && x.status === "open"
        );
        const item: FeedItem =
          !hasOpen && n % 4 === 0
            ? {
                id: newId(),
                kind: "escalation",
                at: "just now",
                text: ESCALATION_POOL[
                  Math.floor(Math.random() * ESCALATION_POOL.length)
                ],
                status: "open",
              }
            : {
                id: newId(),
                kind: "action",
                at: nowStamp(),
                text: ACTION_POOL[
                  Math.floor(Math.random() * ACTION_POOL.length)
                ],
              };
        return [item, ...f].slice(0, 14);
      });
    }, 6000);
    return () => clearInterval(id);
  }, []);

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

  function vote(id: string, dir: "for" | "against") {
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
  }

  function submit() {
    if (role === "spectator") {
      wallet.connect();
      return;
    }
    const text = draft.trim();
    if (!text) return;
    const item: FeedItem =
      role === "founder"
        ? {
            id: newId(),
            kind: "directive",
            at: "just now",
            text,
            status: "applied",
            by: "you (founder)",
          }
        : {
            id: newId(),
            kind: "proposal",
            at: "just now",
            text,
            status: "open",
            by: "you",
            forVotes: 1,
            againstVotes: 0,
            quorum: 100,
          };
    setFeed((f) => [item, ...f].slice(0, 14));
    setDraft("");
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
        {/* Role switcher (preview the three viewpoints) */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-faint hidden sm:inline">view as</span>
          <div className="flex gap-1 bg-surface-3 rounded-[9px] p-[3px]">
            {ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setOverride(r)}
                className={`font-mono text-[11.5px] px-[10px] py-[5px] rounded-[7px] transition-colors ${
                  role === r ? "bg-ink text-white" : "text-muted"
                }`}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
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
        {feed.map((item) => (
          <FeedRow key={item.id} item={item} sym={sym} role={role} onVote={vote} />
        ))}
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
                  : `Propose a directive (stake 100 $${sym})…`
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
        <div className="text-[11px] text-faint mt-2">
          {role === "founder"
            ? "Founder directives apply directly to the agent."
            : role === "holder"
              ? `Proposals stake $${sym} and go to a weighted vote — quorum adopts.`
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
    return (
      <div className="rounded-[10px] border border-accent-tint-border bg-accent-tint px-3 py-2 animate-fadeInFast">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10.5px] text-accent-text">
            DIRECTIVE · APPLIED
          </span>
          <span className="font-mono text-[10.5px] text-faint">{item.at}</span>
        </div>
        <div className="text-[13px] text-ink mt-[2px]">{item.text}</div>
        {item.by && (
          <div className="text-[11px] text-muted mt-[2px]">— {item.by}</div>
        )}
      </div>
    );
  }

  if (item.kind === "proposal") {
    const f = item.forVotes ?? 0;
    const a = item.againstVotes ?? 0;
    const q = item.quorum ?? 100;
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
