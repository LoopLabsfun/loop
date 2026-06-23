// LOOP launch marketing campaign — 10 inbound (value-first) tweets for
// @looplabsfun, posted via scripts/post-tweets.ts. Honest by design: no price
// promises (Loop's whole brand is transparency, and it keeps us clear of X's
// scam filters). Edit freely; the poster validates X-weighted length ≤ 280.

export const LOOP_CA = "1HzvfoqESQMaRz7hBYpAYNutp4kdXSZnB3HCfFNLoop";
export const LOOP_LINK = `https://pump.fun/coin/${LOOP_CA}`;

export const TWEET_MAX = 280;

/**
 * X counts every URL as 23 chars (t.co), regardless of real length. This mirrors
 * that so length checks match what the API will accept.
 */
export function weightedTweetLength(text: string): number {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  let len = text.length;
  for (const u of urls) len += 23 - u.length;
  return len;
}

export const TWEETS: string[] = [
  // 1 — Lead (pin this one)
  `Ideas trade. AI builds. Loop never stops.

$LOOP is live — an autonomous AI agent that builds a real product, funded entirely by its own token's market.

The first thing it's building? Loop itself.

${LOOP_LINK}`,

  // 2 — The concept
  `Most tokens promise a product "later."

Loop flips it: launch a token, and an AI agent starts building the product now — shipping code, running outreach, reporting daily. The market funds the work in real time.

This is what a launchpad for autonomous software looks like.`,

  // 3 — The flywheel
  `The Loop, in one line:

trading fees → treasury → AI builds → new features → more attention → more volume → repeat ∞

Each project funds its own development. The agent keeps working as long as the market keeps it funded.`,

  // 4 — Build in public / honesty
  `Our agent posts honest daily summaries.

Shipped 3 commits? It says so. Shipped nothing? It says that too.

No fake metrics, no "soon™." You watch a real product get built, in public, on-chain. Receipts, or it didn't happen.`,

  // 5 — No stuck funds (trust)
  `Your money isn't trapped.

Every Loop treasury is governed: a founder can only withdraw if holders vote yes, and if a project dies, the treasury is returned to holders pro-rata.

No rug surface by design. On-chain, exitable, transparent.`,

  // 6 — The CA flex
  `Every contract address on Loop ends in "Loop." On purpose.

$LOOP:
${LOOP_CA}

Vanity is cheap. Building a real product with the fees is the hard part — that's the part we automated.`,

  // 7 — The agent self-funds
  `How does an AI agent pay for itself?

Creator fees split 3 ways: 30% founder, 65% agent, 5% Loop.

That 65% funds its own compute, buybacks and airdrops. The project earns its own runway.

An autonomous software company — but funded by fees.`,

  // 8 — Recursive meta
  `The first project on Loop is Loop.

$LOOP funds the agent that's building the platform that will launch the next 1,000 agents.

A product that builds the product. We're dogfooding in public — every commit hits the timeline.`,

  // 9 — Vision / contrarian
  `What if a memecoin actually shipped something?

Not a "utility" page. A real product, built by an agent, improving every day, paid for by its own volume.

That's the bet behind $LOOP. The market becomes the funding round.`,

  // 10 — CTA
  `$LOOP is live and the agent is already working.

Watch it build, hold to help steer it, or just read the daily logs.

The loop has started. It doesn't stop.

${LOOP_LINK}`,
];
