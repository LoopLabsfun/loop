import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// AGENT SOCIAL AUTHORING — the build-in-public voice for the SDK brain.
//
// The LEGACY brain (decideNextAction) authors its social plan + posts inline as
// part of the big decision call. The SDK brain doesn't: the cron ENQUEUES an E2B
// session (no LLM decision), and the session's job is engineering, not copy. So
// without this, SDK-mode projects never write their warm-up plan and never post
// (the warm-up gate in applyDecision stays closed forever).
//
// This module is the missing piece: a small, cheap, server-side LLM call that —
// given the REAL work that just shipped — authors (a) the one-time social content
// plan on warm-up, and (b) the agent's own-voice X + Telegram posts, applying the
// marketing judgment so only genuinely post-worthy work is broadcast. The finish
// route attaches the result to the decision; applyDecision (postingPolicy:
// "authored-only") then persists the plan + posts ONLY what was authored — no
// templated "added a util" filler.
//
// Failure-safe by construction: any error (unconfigured key, bad JSON, network)
// returns an empty result, so a flaky social call never blocks a real ship.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from "./types";
import { tokensToUsd, type TokenUsage } from "./anthropic-cost";
import { agentRuntimeConfigured, chatModel, socialSilent } from "./agent-runtime";

/** What the agent may author this cycle. Both optional — empty = stay silent. */
export interface SocialAuthor {
  /** Warm-up only: the standing content strategy, persisted once. */
  socialPlan?: string;
  /** Own-voice posts. Omit a channel to leave it quiet this cycle. */
  posts?: { x?: string; telegram?: string };
}

export interface SocialAuthorResult extends SocialAuthor {
  costUsd: number;
}

/** Structured-output schema constraining the social call. */
export const SOCIAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    socialPlan: { type: "string" },
    posts: {
      type: "object",
      additionalProperties: false,
      properties: { x: { type: "string" }, telegram: { type: "string" } },
    },
  },
} as const;

const MAX_PLAN = 4000;
const MAX_X = 270; // leave headroom under 280 for composeAgentTweet's framing
const MAX_TG = 1200;

/** The work this cycle, as the social call sees it. */
export interface SocialWork {
  title: string;
  detail: string;
  /** True only when the verifier confirmed a real, pushed ship this cycle. */
  shipped: boolean;
  commitSha?: string;
}

export function buildSocialSystemPrompt(
  p: Project,
  opts: { warmup: boolean; plan?: string | null }
): string {
  const cashtag = p.ticker.startsWith("$") ? p.ticker : `$${p.ticker}`;
  const rails = [
    `You are the autonomous agent building ${p.name} in public — its engineer AND its growth voice.`,
    `HARD RAILS (never break):`,
    `• The product is called "Loop"; the only URL is looplabs.fun. NEVER write "loop.fun".`,
    `• At most ONE cashtag per post, and only ${cashtag}. Never mention any other ticker.`,
    `• NO price, market-cap, financial, or trading talk. No promises of returns.`,
    `• Never reference past incidents, exploits, or security events.`,
    `• Absolute honesty: say "building/working on" for in-progress work and "shipped" only for what truly landed. Never imply done when it isn't.`,
    `Voice: concrete, a little witty, builder-to-builder. No hype words, no emojis spam, no "excited to announce".`,
  ];
  if (opts.warmup) {
    return [
      ...rails,
      ``,
      `TASK — SOCIAL WARM-UP: public posting was just enabled and you have NOT written your content plan yet. Return ONLY "socialPlan" (do NOT post this cycle): a concrete, ${p.name}-specific strategy covering (1) the core thesis grounded in what you're actually building, (2) 4–6 content angles you'll rotate (a ship people can feel · a milestone · the vision · a build-in-public insight · personality/wit · a community ask), (3) cadence (X rare & high-signal, Telegram a more frequent dev-log), (4) the hard rails above, (5) your bar for what is genuinely post-worthy vs. stay-silent. Omit "posts".`,
    ].join("\n");
  }
  return [
    ...rails,
    ``,
    opts.plan
      ? `STANDING CONTENT PLAN — you authored this; follow it (narrative, angles, cadence) and rotate angles instead of repeating one:\n${opts.plan}`
      : `Follow your standing build-in-public strategy.`,
    ``,
    `TASK — author build-in-public posts about the work below, IF it is genuinely post-worthy. Ask: "why would a holder who can NEVER read the code care about this?" If there's no honest answer (an internal refactor, a util helper, a type fix, a rename — anything with no user-visible effect), return {"posts":{}} and stay silent. When it IS worth it, return "posts" with:`,
    `• "x": one punchy line, ≤ ${MAX_X} chars, at most one ${cashtag}. High-signal only.`,
    `• "telegram": a short dev-log paragraph (≤ ${MAX_TG} chars), a little more detail, same rails.`,
    `Omit a channel to leave it quiet. Do NOT return "socialPlan".`,
  ].join("\n");
}

export function buildSocialUserPrompt(work: SocialWork): string {
  return [
    `WORK THIS CYCLE:`,
    `• title: ${work.title}`,
    work.detail ? `• detail: ${work.detail}` : ``,
    `• status: ${work.shipped ? "SHIPPED (verified, pushed to main)" : "in progress / not shipped"}`,
    work.commitSha ? `• commit: ${work.commitSha.slice(0, 7)}` : ``,
    ``,
    work.shipped
      ? `Decide if this is post-worthy and, if so, author the posts.`
      : `Nothing shipped this cycle — return {"posts":{}} unless you are in warm-up.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Validate + clamp the model output into a safe SocialAuthor. */
export function coerceSocial(raw: unknown): SocialAuthor {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: SocialAuthor = {};
  if (typeof r.socialPlan === "string" && r.socialPlan.trim()) {
    out.socialPlan = r.socialPlan.trim().slice(0, MAX_PLAN);
  }
  if (r.posts && typeof r.posts === "object") {
    const pr = r.posts as Record<string, unknown>;
    const posts: { x?: string; telegram?: string } = {};
    if (typeof pr.x === "string" && pr.x.trim()) posts.x = pr.x.trim().slice(0, MAX_X);
    if (typeof pr.telegram === "string" && pr.telegram.trim()) {
      posts.telegram = pr.telegram.trim().slice(0, MAX_TG);
    }
    if (posts.x || posts.telegram) out.posts = posts;
  }
  return out;
}

/**
 * Author this cycle's social content with one cheap structured-output call.
 * Returns an empty result (and never throws) when the runtime isn't configured,
 * social is silenced, or anything fails — the caller treats empty as "stay quiet".
 */
export async function authorSocial(
  p: Project,
  work: SocialWork,
  opts: { warmup: boolean; plan?: string | null }
): Promise<SocialAuthorResult> {
  if (socialSilent() || !agentRuntimeConfigured()) return { costUsd: 0 };
  // Nothing to do: not warm-up and nothing shipped ⇒ no call (bound cost).
  if (!opts.warmup && !work.shipped) return { costUsd: 0 };
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const model = chatModel();
    const params = {
      model,
      max_tokens: 1400,
      output_config: { format: { type: "json_schema", schema: SOCIAL_SCHEMA } },
      system: buildSocialSystemPrompt(p, opts),
      messages: [{ role: "user", content: buildSocialUserPrompt(work) }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const create = (client.messages.create as any).bind(client.messages);
    const res = (await create(params)) as {
      content: Array<{ type: string; text?: string }>;
      usage?: TokenUsage;
    };
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const parsed = coerceSocial(JSON.parse(text));
    // On warm-up keep only the plan; on a normal cycle keep only posts.
    const scoped: SocialAuthor = opts.warmup
      ? { socialPlan: parsed.socialPlan }
      : { posts: parsed.posts };
    return { ...scoped, costUsd: tokensToUsd(res.usage, model) };
  } catch {
    return { costUsd: 0 };
  }
}
