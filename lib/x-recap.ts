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
