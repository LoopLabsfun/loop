import "server-only";

import { getRecentCommitsDated } from "./commits";

// Build-cost throttle. The agent commits to `main` every shipping tick, and
// Vercel auto-builds every push — so a funded */2 cron could trigger ~30
// production builds/hour. That's the cost leak the founder flagged.
//
// Fix: DECOUPLE commit cadence from deploy cadence. Commits still all land on
// main (public + verifiable on GitHub — the build feed links to GitHub SHAs, not
// to Vercel deploys), but the agent stamps a `[no-deploy]` marker on its
// work-commits so Vercel's `ignoreCommand` (see vercel.json) skips the build —
// EXCEPT once per `DEPLOY_MIN_INTERVAL_MIN`, when it omits the marker so that one
// commit deploys and ships the whole accumulated batch. "Plusieurs commits, 1
// deploy."
//
// Marker is on the ABSENCE side on purpose: a commit with no marker always
// builds, so humans / manual pushes / this file's own commit deploy normally —
// only the agent opts specific commits OUT. The marker lives in the commit BODY,
// so it never shows in the public feed (which renders only the subject line).

// Body trailer that tells Vercel's ignoreCommand to skip the production build.
// The ignoreCommand matches it as a WHOLE LINE (`grep -qx`), so a commit that only
// MENTIONS the marker in prose (like the commit that introduced this feature)
// still deploys — only a standalone trailer line skips the build.
export const NO_DEPLOY_MARKER = "[no-deploy]";

/** Pure: does this message carry the skip-build marker on its own line? */
export function hasNoDeployMarker(message: string): boolean {
  return message.split("\n").some((line) => line === NO_DEPLOY_MARKER);
}

/** Pure: append the skip-build marker as a standalone body trailer (idempotent). */
export function appendNoDeployMarker(message: string): string {
  if (hasNoDeployMarker(message)) return message;
  return `${message}\n\n${NO_DEPLOY_MARKER}`;
}

/**
 * Pure throttle decision: should THIS commit trigger a production deploy?
 * Unknown last-deploy time ⇒ true (deploy) — the safe default never silently
 * stalls shipping; only a known, too-recent deploy suppresses the build.
 */
export function shouldDeployNow(opts: {
  lastDeployAtMs: number | null;
  nowMs: number;
  minIntervalMs: number;
}): boolean {
  const { lastDeployAtMs, nowMs, minIntervalMs } = opts;
  if (lastDeployAtMs === null) return true;
  return nowMs - lastDeployAtMs >= minIntervalMs;
}

/** Throttle config from env. OFF unless DEPLOY_THROTTLE=1 (default interval 60m). */
export function deployThrottleConfig(): { enabled: boolean; minIntervalMs: number } {
  const enabled = process.env.DEPLOY_THROTTLE === "1";
  const min = Number(process.env.DEPLOY_MIN_INTERVAL_MIN ?? 60);
  const minIntervalMs = (Number.isFinite(min) && min > 0 ? min : 60) * 60_000;
  return { enabled, minIntervalMs };
}

/**
 * Newest commit that ACTUALLY deployed (no `[no-deploy]` marker), as epoch ms —
 * the anchor the throttle measures the gap from. null when none is found in the
 * recent window (treated as "deploy now"). Reads live commits (no cache).
 */
export async function lastDeployAnchorAt(repo: string): Promise<number | null> {
  const commits = await getRecentCommitsDated(repo, 30); // newest-first
  for (const c of commits) {
    if (!hasNoDeployMarker(c.msg)) return c.date;
  }
  return null;
}

/**
 * Decorate a commit message for the build-throttle: returns it unchanged when
 * throttling is off OR when a deploy is due; otherwise appends the `[no-deploy]`
 * marker so Vercel skips the build. Any failure falls back to the bare message —
 * i.e. errs toward deploying, never toward silently dropping a deploy.
 */
export async function commitMessageWithThrottle(
  baseMessage: string,
  repo: string,
  nowMs: number = Date.now()
): Promise<string> {
  const { enabled, minIntervalMs } = deployThrottleConfig();
  if (!enabled) return baseMessage;
  try {
    const lastDeployAtMs = await lastDeployAnchorAt(repo);
    const deploy = shouldDeployNow({ lastDeployAtMs, nowMs, minIntervalMs });
    return deploy ? baseMessage : appendNoDeployMarker(baseMessage);
  } catch {
    return baseMessage;
  }
}
