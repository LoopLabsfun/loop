import type { Project } from "./types";
import { agentSite } from "./agent";

// ─────────────────────────────────────────────────────────────────────────────
// X (TWITTER) RECAP — the shared @loop account tweets a recap when a project
// launches, à la Polsia. This module is the pure, testable part: composing the
// tweet from real project data, capped to X's 280-char limit. Delivery (posting
// via the X API with founder-connected OAuth) is a thin wrapper added later —
// X forbids programmatic account creation, so @loop is a human-created account
// the agent posts to (see docs/agent-runtime.md §5).
// ─────────────────────────────────────────────────────────────────────────────

export const TWEET_MAX = 280;

/** Collapse whitespace + trim, then hard-cap with an ellipsis. */
function clamp(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : t.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/** Hard-cap with an ellipsis WITHOUT collapsing whitespace (caller pre-cleans). */
function cut(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/** Single-line a field: trim + collapse runs of whitespace to one space. */
function oneLine(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

// X treats "$WORD" as a cashtag and REJECTS any tweet carrying more than one
// (HTTP 403: "Posts are limited to a maximum of one cashtag"). Our templates
// always carry the project's own ($)ticker, so neutralize every other
// cashtag-like token the agent may have written into the task text
// ("$LOOP" → "LOOP") to guarantee the post is accepted.
function stripCashtags(s: string): string {
  return s.replace(/\$(?=[A-Za-z])/g, "");
}

export interface LaunchTweetOptions {
  /** Override the project URL (defaults to the agent site). */
  url?: string;
  /** The shared Loop account handle to attribute to. */
  loopHandle?: string;
}

/**
 * Compose the launch-recap tweet for a newly launched project. Always fits in
 * TWEET_MAX: the vision line is trimmed first (never the header/handle/link).
 */
export function buildLaunchTweet(p: Project, opts: LaunchTweetOptions = {}): string {
  const handle = opts.loopHandle ?? "@loop";
  const url = opts.url ?? agentSite(p);
  const header = `🚀 ${p.name} (${p.ticker}) just launched on ${handle}`;
  const closer = "An AI agent builds it now — funded by its market.";

  // Room left for the vision line in the with-vision layout:
  //   header \n\n {vision} \n\n closer \n url   → 5 newline chars of framing.
  const framing = header.length + closer.length + url.length + 5;
  const room = TWEET_MAX - framing;

  const vision = (p.description ?? "").trim();
  const body =
    vision && room > 12
      ? `${header}\n\n${clamp(vision, room)}\n\n${closer}\n${url}`
      : `${header}\n\n${closer}\n${url}`;

  return clamp(body, TWEET_MAX);
}

export interface SelfLaunchTweetOptions {
  name: string;
  symbol: string;
  /** On-chain mint address (the CA). Never dropped to fit the cap. */
  mint: string;
  /** Trade/coin link, e.g. https://pump.fun/coin/<mint>. Never dropped. */
  url: string;
  description?: string;
}

/**
 * Compose the launch announcement posted FROM a project's own account (e.g.
 * @looplabsfun announcing $LOOP itself) — distinct from buildLaunchTweet, which
 * is the shared @loop account attributing OTHER projects. Always fits in
 * TWEET_MAX: the CA and link are guaranteed; the description is trimmed (or
 * dropped) first.
 */
export function buildSelfLaunchTweet(opts: SelfLaunchTweetOptions): string {
  const header = `🚀 $${opts.symbol} is live on pump.fun.`;
  const ca = `CA: ${opts.mint}`;

  // header \n\n {desc} \n\n ca \n url  → 5 newline chars of framing.
  const framing = header.length + ca.length + opts.url.length + 5;
  const room = TWEET_MAX - framing;

  const vision = (opts.description ?? "").trim();
  const body =
    vision && room > 12
      ? `${header}\n\n${clamp(vision, room)}\n\n${ca}\n${opts.url}`
      : `${header}\n\n${ca}\n${opts.url}`;

  return clamp(body, TWEET_MAX);
}

export interface ShipTweetOptions {
  /** Override the watch link (defaults to the agent site). */
  url?: string;
}

/**
 * Compose an honest BUILD-IN-PUBLIC progress tweet from the agent's real current
 * decision — what it's working on right now, NOT a "shipped" claim (use
 * buildShipTweet for that). Lets the agent post frequently without faking
 * completion: the verb is "building", the timeline stays truthful. One cashtag
 * (X rejects >1), never drops the watch link, no price/financial framing.
 */
export function buildProgressTweet(
  p: Project,
  work: { title: string; detail?: string },
  opts: ShipTweetOptions = {}
): string {
  const cashtag = "$" + p.ticker.replace(/^\$+/, "");
  const url = opts.url ?? agentSite(p);
  const closer = "Built by its agent, funded by its market.";

  const title = stripCashtags(oneLine(work.title ?? ""));
  const detail = stripCashtags(oneLine(work.detail ?? ""));

  const frame = (t: string, d: string) =>
    d
      ? `🛠️ ${cashtag} building: ${t}\n\n${d}\n\n${closer}\n${url}`
      : `🛠️ ${cashtag} building: ${t}\n\n${closer}\n${url}`;

  const t = cut(title, Math.max(0, TWEET_MAX - frame("", "").length));
  const detailRoom = TWEET_MAX - frame(t, "").length - 2;
  return detail && detailRoom > 12 ? frame(t, cut(detail, detailRoom)) : frame(t, "");
}

/**
 * Wrap a tweet the AGENT wrote itself (its own voice — a punchy one-liner) for
 * safe posting, instead of templating the same `{title, detail}` the Telegram
 * post derives from. The agent's words ARE the tweet; we only enforce the
 * platform/honesty floor mechanically: collapse to one line, neutralize every
 * cashtag (X rejects >1), then append a canonical footer carrying exactly the
 * project's own cashtag + the watch link so the post is always discoverable and
 * links back. The body is trimmed so the footer always fits TWEET_MAX. Use this
 * when the agent supplied a self-authored `posts.x`; otherwise fall back to
 * buildProgressTweet / buildShipTweet.
 */
export function composeAgentTweet(
  p: Project,
  text: string,
  opts: ShipTweetOptions = {}
): string {
  const cashtag = "$" + p.ticker.replace(/^\$+/, "");
  const url = opts.url ?? agentSite(p);
  const footer = `${cashtag} · ${url}`;
  // Strip every cashtag (avoids the >1 rejection and a wrong-ticker mention) and
  // drop a watch link the agent may have written inline (the footer carries it).
  let body = stripCashtags(oneLine(text ?? "")).split(url).join("").trim();
  const room = TWEET_MAX - footer.length - 2; // 2 = the "\n\n" before the footer
  body = cut(body, Math.max(0, room));
  return body ? `${body}\n\n${footer}` : footer;
}

/**
 * Compose a "just shipped" tweet from a project's REAL agent task — the X
 * counterpart of the Telegram build update (buildUpdateMessage). The runtime
 * posts it ONLY when work actually ships (the verifier-gated signal), so the
 * timeline is honest by construction: nothing shipped ⇒ no tweet, never fake
 * progress. Always fits TWEET_MAX, carries exactly ONE cashtag (X rejects >1),
 * and never drops the watch link; the optional detail line is trimmed — or
 * dropped — to fit first.
 */
export function buildShipTweet(
  p: Project,
  task: { title: string; detail?: string },
  opts: ShipTweetOptions = {}
): string {
  const cashtag = "$" + p.ticker.replace(/^\$+/, "");
  const url = opts.url ?? agentSite(p);
  const closer = "Built by its agent, funded by its market.";

  const title = stripCashtags(oneLine(task.title ?? ""));
  const detail = stripCashtags(oneLine(task.detail ?? ""));

  // header \n\n [detail \n\n] closer \n url. frame("", "") fixes the framing
  // length, so the title (then the detail) gets exactly the room that's left.
  const frame = (t: string, d: string) =>
    d
      ? `🛠️ ${cashtag} shipped: ${t}\n\n${d}\n\n${closer}\n${url}`
      : `🛠️ ${cashtag} shipped: ${t}\n\n${closer}\n${url}`;

  // Cap the title so the no-detail tweet always fits, then spend any remaining
  // room on the detail line (the extra "\n\n" before it costs 2 chars).
  const t = cut(title, Math.max(0, TWEET_MAX - frame("", "").length));
  const detailRoom = TWEET_MAX - frame(t, "").length - 2;
  return detail && detailRoom > 12 ? frame(t, cut(detail, detailRoom)) : frame(t, "");
}
