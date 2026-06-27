"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RichText } from "../RichText";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import {
  defaultMandate,
  roleFor,
  type ConsoleRole,
  type FeedItem,
} from "@/lib/console";
import {
  submitDirectiveAction,
  castVoteAction,
  moderateDirectiveAction,
  resolveDirectiveAction,
  setProposalExecAction,
  submitChatAction,
  submitStakeAction,
  getStakeAction,
} from "@/lib/actions";
import { isSuspiciousDirective, proposalQuorum } from "@/lib/directives";
import { stakeMin, sanitizeStakeAmount } from "@/lib/staking";
import { type ChatMsg } from "@/lib/chat";
import { agentRunState } from "@/lib/budget";
import { explorerTx, shortAddr } from "@/lib/format";
import { useInspector } from "@/lib/inspector";
import type { AgentTask } from "@/lib/agent";
import type { Project } from "@/lib/types";

const fmtLoop = (n: number) => Math.round(n).toLocaleString("en-US");

// A single merged-feed entry: a steering item (directive/proposal/escalation/
// action) OR a paid chat question. Sorted newest-first by `ts` so the two
// streams read as one conversation with the agent.
type Entry =
  | { type: "gov"; ts: number; item: FeedItem }
  | { type: "chat"; ts: number; msg: ChatMsg };

export function AgentFeed({
  project: p,
  directives,
  chat = [],
  tasks = [],
}: {
  project: Project;
  /** Persisted directives/proposals from the backend (newest first). */
  directives?: FeedItem[];
  /** Persisted paid chat questions (newest first). */
  chat?: ChatMsg[];
  tasks?: AgentTask[];
}) {
  const wallet = useWallet();
  const { network, setNetwork } = useNetwork();
  const sym = p.ticker.replace(/^\$/, "");
  const mandate = useMemo(() => defaultMandate(p), [p]);
  const projectNet = p.network ?? "mainnet";
  const wrongNet = network !== projectNet;
  const runState = agentRunState(p);

  // Role is derived from the connected wallet only — no manual role switcher.
  // No wallet ⇒ spectator (read-only); the project's creator wallet ⇒ founder.
  const role = roleFor(wallet.connected, wallet.address, p.creatorWallet);

  // Real persisted directives/proposals only — no simulated activity. Empty
  // until a founder/holder steers or the runtime streams actions.
  const [feed, setFeed] = useState<FeedItem[]>(() => directives ?? []);
  const [messages, setMessages] = useState<ChatMsg[]>(chat);
  const [draft, setDraft] = useState("");
  // One composer, two actions — no mode tabs. `pending` is whichever action is
  // mid-signature ("ask" = a question, "steer" = a directive/proposal), or null.
  const [pending, setPending] = useState<null | "ask" | "steer">(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Stake-to-participate: the connected wallet's active stake (null until loaded /
  // disconnected), the stake-amount draft, and whether a stake is mid-signature.
  const [stake, setStake] = useState<{
    staked: number;
    tier: string | null;
    min: number;
  } | null>(null);
  const [stakeDraft, setStakeDraft] = useState("");
  const [staking, setStaking] = useState(false);
  const idRef = useRef(1000);
  const newId = () => `c${idRef.current++}`;

  // The merged, newest-first feed both streams render as one.
  const entries: Entry[] = useMemo(() => {
    const gov: Entry[] = feed
      .filter((f) => f.kind !== "escalation") // escalation has its own banner
      .map((item) => ({ type: "gov", ts: item.ts ?? 0, item }));
    const msgs: Entry[] = messages.map((msg) => ({ type: "chat", ts: msg.ts ?? 0, msg }));
    return [...gov, ...msgs].sort((a, b) => b.ts - a.ts);
  }, [feed, messages]);

  // Steering the agent (ask + steer) is unlocked by an active $LOOP stake — no
  // per-message on-chain transfer (which Phantom/Blowfish flagged as a scam on a
  // new domain+token). Needs the project token to read/stake $LOOP against.
  const canChat = !!p.mint;
  const busy = pending != null;
  const staked = stake?.staked ?? 0;
  const stakeFloor = stake?.min ?? stakeMin();
  const isStaked = staked >= stakeFloor;

  // Load the connected wallet's active stake (and clear it on disconnect) so the
  // composer knows whether participation is unlocked.
  useEffect(() => {
    let cancelled = false;
    if (wallet.connected && wallet.address && p.key) {
      getStakeAction(p.key, wallet.address).then((s) => {
        if (!cancelled) setStake(s);
      });
    } else {
      setStake(null);
    }
    return () => {
      cancelled = true;
    };
  }, [wallet.connected, wallet.address, p.key]);

  // Stake $LOOP to unlock steering. A SIGNED commitment (no transfer → no Blowfish
  // flag); the server verifies the signature AND that the wallet really holds the
  // staked $LOOP on-chain. v1 takes no custody — the $LOOP stays in the wallet.
  async function stakeNow() {
    if (!wallet.connected || !wallet.address) {
      wallet.connect();
      return;
    }
    if (wrongNet) {
      setNetwork(projectNet);
      return;
    }
    const amount = sanitizeStakeAmount(stakeDraft) || stakeFloor;
    if (amount < stakeFloor) {
      setNotice(`Minimum stake is ${fmtLoop(stakeFloor)} $${sym}.`);
      return;
    }
    setNotice(null);
    setStaking(true);
    try {
      const proof = await wallet.signStakeProof(p.key, amount);
      if (!proof) {
        setNotice("Your wallet can't sign messages.");
        setStaking(false);
        return;
      }
      const res = await submitStakeAction({
        projectKey: p.key,
        wallet: wallet.address,
        amount,
        proof,
      });
      if (res.ok) {
        setStake({ staked: res.staked ?? amount, tier: res.tier ?? null, min: stakeFloor });
        setStakeDraft("");
      } else {
        setNotice(res.error ?? "Couldn't record your stake.");
      }
      setStaking(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Signing failed";
      setNotice(/reject|denied|cancel/i.test(msg) ? "Cancelled in wallet" : msg);
      setStaking(false);
    }
  }

  // The one path for both actions: a USER-SIGNED message (moves no funds, so it
  // never trips the Phantom/Blowfish scanner) gated by an active stake, then it's
  // recorded ("ask" → a question the agent answers; "steer" → a directive (founder)
  // or a holder proposal). The text is screened with the same injection guard, and
  // the signature also proves authorship.
  async function send(kind: "ask" | "steer") {
    if (kind === "steer" && role === "spectator") {
      wallet.connect();
      return;
    }
    if (!wallet.connected || !wallet.address) {
      wallet.connect();
      return;
    }
    if (wrongNet) {
      setNetwork(projectNet);
      return;
    }
    const text = draft.trim();
    if (!text || busy) return;
    if (isSuspiciousDirective(text)) {
      setNotice(
        "Rejected — talk in plain language. No wallet addresses or override instructions; the agent can't move funds from here."
      );
      return;
    }
    if (!p.mint) return;
    if (!isStaked) {
      setNotice(`Stake at least ${fmtLoop(stakeFloor)} $${sym} to steer the agent.`);
      return;
    }
    setNotice(null);
    setPending(kind);
    try {
      if (kind === "ask") {
        // Sign the question (no transfer → no Blowfish flag); the stake is the gate.
        const proof = await wallet.signChatProof(p.key, text);
        if (!proof) {
          setNotice("Your wallet can't sign messages.");
          setPending(null);
          return;
        }
        const optimistic: ChatMsg = {
          id: `local-${Date.now()}`,
          wallet: wallet.address,
          question: text,
          answer: null,
          loopPaid: 0,
          boost: 0,
          txSig: null,
          status: "open",
          at: "just now",
          ts: Date.now(),
        };
        setMessages((m) => [optimistic, ...m].slice(0, 30));
        setDraft("");
        const res = await submitChatAction({
          projectKey: p.key,
          wallet: wallet.address,
          question: text,
          proof,
        });
        if (!res.ok) setNotice(res.error ?? "Couldn't record your message.");
      } else {
        // A console submission is never authoritative: it's queued as an open
        // suggestion (the agent treats console text as untrusted), even though the
        // signature verifies authorship — steering confers no on-chain authority.
        const proof = await wallet.signDirectiveProof(p.key, text);
        if (!proof) {
          setNotice("Your wallet can't sign messages.");
          setPending(null);
          return;
        }
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
                quorum: proposalQuorum(p.holders),
              };
        setFeed((f) => [item, ...f].slice(0, 14));
        setDraft("");
        const res = await submitDirectiveAction({
          projectKey: p.key,
          text,
          kind: role === "founder" ? "directive" : "proposal",
          authorWallet: wallet.address,
          holders: p.holders,
          proof,
        });
        if (!res.ok) setNotice(res.error ?? "Couldn't record your message.");
      }
      setPending(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Signing failed";
      setNotice(/reject|denied|cancel/i.test(msg) ? "Cancelled in wallet" : msg);
      setPending(null);
    }
  }

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

  // Founder moderation: hide an undesirable directive/proposal from the public
  // feed. Only persisted rows (feed id "d…") are moderatable; optimistic local
  // items are removed instantly. Non-destructive + reversible server-side.
  async function hide(id: string) {
    if (role !== "founder" || !wallet.address) return;
    setFeed((f) => f.filter((x) => x.id !== id)); // optimistic remove
    if (!id.startsWith("d")) return;
    const res = await moderateDirectiveAction({
      projectKey: p.key,
      directiveId: id.slice(1),
      moderatorWallet: wallet.address,
      hidden: true,
    });
    if (!res.ok) setNotice(res.error ?? "Couldn't hide that — try again.");
  }

  // Founder resolution: mark a proposal/directive done. "adopted" for a proposal
  // (confirm the holders' ask), "applied" for a directive. Optimistic; persists
  // for backend rows ("d…"). The counterpart to the agent's auto-resolution.
  async function markDone(id: string, kind: FeedItem["kind"]) {
    if (role !== "founder" || !wallet.address) return;
    const status = kind === "proposal" ? "adopted" : "applied";
    const snapshot = feed;
    setFeed((f) => f.map((x) => (x.id === id ? { ...x, status } : x)));
    if (!id.startsWith("d")) return;
    const res = await resolveDirectiveAction({
      projectKey: p.key,
      directiveId: id.slice(1),
      moderatorWallet: wallet.address,
      status,
    });
    if (!res.ok) {
      setFeed(snapshot);
      setNotice(res.error ?? "Couldn't update that — try again.");
    }
  }

  // Founder execution-triage on an ADOPTED proposal: Done / To-do (the agent's
  // queue) / Refused. The vote decides adoption; this decides what the founder
  // does with it. Optimistic; persists for backend rows.
  async function setExec(id: string, exec: "todo" | "done" | "refused") {
    if (role !== "founder" || !wallet.address) return;
    // Toggle off when re-clicking the active triage (back to untriaged).
    const current = feed.find((x) => x.id === id)?.exec;
    const next = current === exec ? null : exec;
    const snapshot = feed;
    setFeed((f) => f.map((x) => (x.id === id ? { ...x, exec: next ?? undefined } : x)));
    if (!id.startsWith("d")) return;
    const res = await setProposalExecAction({
      projectKey: p.key,
      directiveId: id.slice(1),
      moderatorWallet: wallet.address,
      exec: next,
    });
    if (!res.ok) {
      setFeed(snapshot);
      setNotice(res.error ?? "Couldn't update that — try again.");
    }
  }

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-[14px] border-b border-line-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-[7px] h-[7px] rounded-full bg-pos-bright animate-pulseFast" />
            <span className="font-display font-semibold text-[15px]">
              Agent · {p.name}
            </span>
          </div>
          <div className="text-[12px] text-faint mt-[2px]">
            Ask it a question or steer it — one feed · {mandate.model} · {mandate.budget}
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

      {/* Feed — questions + steering, one stream, newest first */}
      <div className="px-5 py-3 flex flex-col gap-[10px] max-h-[340px] overflow-y-auto scroll-thin">
        {entries.length === 0 ? (
          <div className="text-[12.5px] text-faint text-center py-6">
            Nothing yet — ask the agent a question or steer it, and it appears here.
          </div>
        ) : (
          entries.map((e) =>
            e.type === "chat" ? (
              <ChatFeedRow
                key={e.msg.id}
                msg={e.msg}
                you={e.msg.wallet === wallet.address}
              />
            ) : (
              <FeedRow
                key={e.item.id}
                item={e.item}
                sym={sym}
                role={role}
                onVote={vote}
                onHide={hide}
                onResolve={markDone}
                onExec={setExec}
              />
            )
          )
        )}
      </div>

      {/* Composer — one box, two actions (no mode tabs): Ask a question, or steer
          (Direct/Propose). Each one SIGNS a message (moves no funds → no Phantom/
          Blowfish flag); an active $LOOP stake is the gate, not a per-message fee. */}
      <div className="px-5 py-[14px] border-t border-line-4">
        {!canChat ? (
          <div className="text-[12.5px] text-faint text-center py-2">
            Talking to the agent opens when {p.ticker} launches on-chain.
          </div>
        ) : !wallet.connected ? (
          <button
            onClick={() => wallet.connect()}
            className="w-full font-display font-semibold text-[14px] px-5 py-[10px] rounded-[10px] bg-ink text-white hover:bg-ink-2 transition-colors"
          >
            Connect wallet to participate
          </button>
        ) : wrongNet ? (
          <button
            onClick={() => setNetwork(projectNet)}
            className="w-full font-display font-semibold text-[14px] px-5 py-[10px] rounded-[10px] border border-warn text-warn"
          >
            Switch to {projectNet}
          </button>
        ) : !isStaked ? (
          // Stake-to-participate gate: sign a stake (no transfer) to unlock asking +
          // steering. The $LOOP stays in the wallet — v1 takes no custody.
          <div className="flex flex-col gap-2">
            <div className="text-[12.5px] text-body">
              Stake{" "}
              <span className="font-mono text-muted">
                {fmtLoop(stakeFloor)} ${sym}
              </span>{" "}
              to ask + steer the agent. Signing only — it never leaves your wallet,
              so Phantom won&apos;t flag it as a scam.
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 border border-line-3 rounded-[9px] px-2 py-1 bg-surface">
                <input
                  value={stakeDraft}
                  onChange={(e) => setStakeDraft(e.target.value)}
                  inputMode="numeric"
                  placeholder={fmtLoop(stakeFloor)}
                  className="w-[104px] border-0 outline-none bg-transparent font-mono text-[12.5px] py-1"
                />
                <span className="font-mono text-[11px] text-faint">${sym}</span>
              </div>
              <button
                onClick={stakeNow}
                disabled={staking}
                className="ml-auto font-display font-semibold text-[13.5px] px-5 py-[10px] rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                {staking ? "Sign in wallet…" : "Stake to participate"}
              </button>
            </div>
            <div className="text-[11px] text-faint leading-[1.5]">
              One signature unlocks unlimited asks + proposals. Higher stakes carry
              more governance weight. Locked-vault staking + rewards are coming.
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 mb-2 text-[11.5px]">
              <span className="text-faint">
                Staked{" "}
                <span className="font-mono text-muted">
                  {fmtLoop(staked)} ${sym}
                </span>
                {stake?.tier ? (
                  <span className="ml-1 text-accent-text">· {stake.tier}</span>
                ) : null}
              </span>
              <span className="text-faint">steering unlocked</span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send("ask");
              }}
              rows={2}
              placeholder={
                role === "founder"
                  ? `Ask ${p.name} a question, or send it a directive…`
                  : `Ask ${p.name} a question, or propose a direction…`
              }
              className="loop-input resize-none w-full py-[10px]"
            />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => send("steer")}
                  disabled={busy}
                  className="font-display font-semibold text-[13.5px] px-4 py-[10px] rounded-[10px] border border-line-3 bg-surface text-ink hover:border-accent hover:text-accent-text transition-colors disabled:opacity-60 whitespace-nowrap"
                >
                  {pending === "steer"
                    ? "Sign in wallet…"
                    : role === "founder"
                      ? "Send Directive"
                      : "Open Proposal"}
                </button>
                <button
                  onClick={() => send("ask")}
                  disabled={busy}
                  className="font-display font-semibold text-[13.5px] px-4 py-[10px] rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors disabled:opacity-60 whitespace-nowrap"
                >
                  {pending === "ask" ? "Sign in wallet…" : "Ask Question"}
                </button>
              </div>
            </div>
            <div className="text-[11px] text-faint mt-2 leading-[1.5]">
              Free once staked — each action is a wallet signature, no transfer.{" "}
              <span className="text-body">Ask Question</span> gets a written answer
              {runState === "active" ? " on the next run" : " once the agent wakes"}.{" "}
              <span className="text-body">
                {role === "founder" ? "Send Directive" : "Open Proposal"}
              </span>{" "}
              {role === "founder"
                ? "queues a directive for the agent"
                : `opens a $${sym}-weighted holder vote`}
              . They steer the agent — they never move funds.
            </div>
          </>
        )}
        {notice && <div className="text-[11px] text-neg mt-2">{notice}</div>}
      </div>
    </div>
  );
}

// A paid chat question in the merged feed — compact by design: the question +
// its state, click to read the full answer in the side panel (the founder's
// "ask in the feed, read in the panel" split).
function ChatFeedRow({ msg: m, you }: { msg: ChatMsg; you: boolean }) {
  const { inspect } = useInspector();
  const answered = m.status === "answered" && !!m.answer;
  return (
    <button
      onClick={() => inspect({ kind: "chat", msg: m })}
      className="text-left rounded-[10px] border border-line-3 bg-surface px-3 py-2 animate-fadeInFast hover:border-line-hover transition-colors w-full"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] text-muted">
          <span className="text-accent-text">✦ Q</span> · {you ? "you" : shortAddr(m.wallet)}
          {m.boost > 0 && (
            <span className="ml-[6px] text-accent-text">▲ {fmtLoop(m.boost)} boost</span>
          )}
        </span>
        <span className="font-mono text-[10.5px] text-faint">{m.at}</span>
      </div>
      <div className="text-[13px] text-ink mt-[2px] line-clamp-2">
        <RichText text={m.question} />
      </div>
      <div className="mt-[5px] font-mono text-[10.5px]">
        {answered ? (
          <span className="text-pos">✓ answered · read in panel →</span>
        ) : (
          <span className="text-faint">⏳ queued — answers on the next run</span>
        )}
      </div>
    </button>
  );
}

/** Founder-only control to hide a directive/proposal from the public feed. */
function HideButton({ id, onHide }: { id: string; onHide: (id: string) => void }) {
  return (
    <button
      onClick={() => onHide(id)}
      title="Hide from the public feed"
      aria-label="Hide from the public feed"
      className="font-mono text-[10.5px] text-faint hover:text-neg transition-colors"
    >
      hide
    </button>
  );
}

/** Founder-only control to confirm a directive/proposal as done. */
function DoneButton({
  id,
  kind,
  onResolve,
}: {
  id: string;
  kind: FeedItem["kind"];
  onResolve: (id: string, kind: FeedItem["kind"]) => void;
}) {
  return (
    <button
      onClick={() => onResolve(id, kind)}
      title="Confirm as done"
      aria-label="Confirm as done"
      className="font-mono text-[10.5px] text-faint hover:text-pos transition-colors"
    >
      ✓ done
    </button>
  );
}

// The founder's execution-triage on an adopted proposal. One source of truth for
// the chip (everyone) and the active-button styling (founder).
const EXEC_META: Record<
  "todo" | "done" | "refused",
  { label: string; glyph: string; cls: string; active: string }
> = {
  done: { label: "Done", glyph: "✓", cls: "text-pos", active: "bg-pos text-white border-pos" },
  todo: { label: "To-do", glyph: "→", cls: "text-accent-text", active: "bg-accent text-white border-accent" },
  refused: { label: "Refused", glyph: "✕", cls: "text-neg", active: "bg-neg text-white border-neg" },
};

/**
 * Founder execution-triage (Done / To-do / Refused) — the single source of truth
 * for both adopted proposals AND directives (the founder's own instruction). The
 * founder decides what happens next: 'todo' is the agent's build-next queue,
 * 'done'/'refused' drop the item from the agent's steering. Everyone sees the set
 * state; only the founder gets the buttons.
 */
function ExecTriage({
  item,
  role,
  onExec,
}: {
  item: FeedItem;
  role: ConsoleRole;
  onExec: (id: string, exec: "todo" | "done" | "refused") => void;
}) {
  return (
    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-line-4 flex-wrap">
      {item.exec ? (
        <span className={`font-mono text-[10.5px] ${EXEC_META[item.exec].cls}`}>
          {EXEC_META[item.exec].glyph} {EXEC_META[item.exec].label.toUpperCase()}
          {item.exec === "todo" && (
            <span className="text-faint"> · agent&apos;s queue</span>
          )}
        </span>
      ) : (
        <span className="font-mono text-[10.5px] text-faint">awaiting triage</span>
      )}
      {role === "founder" && (
        <span className="ml-auto flex items-center gap-1">
          {(["done", "todo", "refused"] as const).map((e) => {
            const m = EXEC_META[e];
            const on = item.exec === e;
            return (
              <button
                key={e}
                onClick={() => onExec(item.id, e)}
                title={
                  e === "done"
                    ? "Mark as already done"
                    : e === "todo"
                      ? "Queue for the agent to build next"
                      : "Refuse this"
                }
                className={`font-mono text-[10.5px] px-2 py-[3px] rounded-[7px] border transition-colors ${
                  on
                    ? m.active
                    : "border-line-3 bg-surface text-muted hover:border-line-hover"
                }`}
              >
                {m.glyph} {m.label}
              </button>
            );
          })}
        </span>
      )}
    </div>
  );
}

function FeedRow({
  item,
  sym,
  role,
  onVote,
  onHide,
  onResolve,
  onExec,
}: {
  item: FeedItem;
  sym: string;
  role: ConsoleRole;
  onVote: (id: string, dir: "for" | "against") => void;
  onHide: (id: string) => void;
  onResolve: (id: string, kind: FeedItem["kind"]) => void;
  onExec: (id: string, exec: "todo" | "done" | "refused") => void;
}) {
  const { inspect } = useInspector();
  const isFounderRow =
    role === "founder" && (item.kind === "directive" || item.kind === "proposal");
  const canHide = isFounderRow;
  // The founder can confirm anything still open; a resolved row shows no control.
  const canDone = isFounderRow && (item.status === "open" || item.status == null);
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
          <button
            onClick={() => inspect({ kind: "directive", item })}
            className="text-[12px] text-faint mt-[2px] break-words text-left block hover:text-ink transition-colors"
          >
            {item.text}
          </button>
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
          <span className="flex items-center gap-2">
            {canHide && <HideButton id={item.id} onHide={onHide} />}
            <span className="font-mono text-[10.5px] text-faint">{item.at}</span>
          </span>
        </div>
        <button
          onClick={() => inspect({ kind: "directive", item })}
          className="text-[13px] text-ink mt-[2px] break-words text-left block w-full hover:text-accent-text transition-colors"
        >
          {item.text}
        </button>
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
        {/* A directive is the founder's own instruction — let them triage it the
            same way as an adopted proposal (To-do queues it for the agent). */}
        {(isFounderRow || item.exec) && (
          <ExecTriage item={item} role={role} onExec={onExec} />
        )}
      </div>
    );
  }

  if (item.kind === "proposal") {
    const f = item.forVotes ?? 0;
    const a = item.againstVotes ?? 0;
    const q = item.quorum ?? 10;
    const pct = Math.min(100, Math.round(((f + a) / q) * 100));
    // Resolved by a passing holder vote (the agent's auto-resolution) or a founder
    // confirm — surface the outcome instead of live vote controls.
    const adopted = item.status === "adopted";
    const resolved = adopted || item.status === "declined";
    return (
      <div className="rounded-[10px] border border-line-3 bg-surface px-3 py-2 animate-fadeInFast">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10.5px] text-muted">
            PROPOSAL {item.by ? `· ${item.by}` : ""} ·{" "}
            {resolved ? (
              <span className={adopted ? "text-pos" : "text-neg"}>
                {adopted ? "ADOPTED" : "DECLINED"}
              </span>
            ) : (
              <span className="text-accent-text">PROPOSED</span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {canDone && (
              <DoneButton id={item.id} kind={item.kind} onResolve={onResolve} />
            )}
            {canHide && <HideButton id={item.id} onHide={onHide} />}
            <span className="font-mono text-[10.5px] text-faint">{item.at}</span>
          </span>
        </div>
        <button
          onClick={() => inspect({ kind: "proposal", item })}
          className="text-[13px] text-ink mt-[2px] mb-2 text-left block w-full hover:text-accent-text transition-colors"
        >
          {item.text}
        </button>
        <div className="h-[6px] rounded-full bg-surface-3 overflow-hidden mb-1">
          <div
            className={`h-full ${
              resolved ? (adopted ? "bg-pos" : "bg-neg") : "bg-accent"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>
            <span className="text-pos">{f} for</span> ·{" "}
            <span className="text-neg">{a} against</span> · quorum {q}
          </span>
          {resolved ? (
            <span className={adopted ? "text-pos" : "text-neg"}>
              {adopted ? "✓ adopted by vote" : "✗ declined"}
            </span>
          ) : role !== "spectator" ? (
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
        {/* Founder execution-triage — only once the proposal is adopted. The vote
            decides adoption; the founder decides what happens to it next. */}
        {/* Founder execution-triage — once the proposal is adopted, the founder
            decides what happens to it next (the vote only decides adoption). */}
        {adopted && <ExecTriage item={item} role={role} onExec={onExec} />}
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
