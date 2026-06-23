# Agent marketing skill — making the agent post like a marketer, not a changelog

## The problem (diagnosed 2026-06-22)

The agent's public posts (X + Telegram) read like a raw commit log:

```
Dev log: shipped a budget-guard util for the agent.
Dev-log: shipped /agent-actions/stats — aggregates the on-chain action log…
🛠️ LOOP — building • Add budgetStatus(spent/cap/remaining/pct) clamped pure helper…
```

Four root causes, all in `lib/agent-runtime.ts`:

1. **No marketing brain.** Telegram guidance is literally *"a short dev-log: what
   you're doing now, why it matters, what's next"* (line ~365). That yields
   engineering jargon (`budget-status endpoint`) that means nothing to a holder.
2. **Cadence too high.** Every shipped tick → a post. The only gate
   (`shouldPublishUpdate`) blocks exact-duplicate text + a min time gap.
3. **No variety / anti-repetition.** It only compares to the **last** post, so
   near-identical "shipped X endpoint" posts stream out back-to-back.
4. **Wrong venue.** Build-logs go to the public broadcast **channel**, spamming
   the marketing surface instead of a build-log topic.

## The fix — four layers

### 1. Separate the venues (structural)
- **Broadcast channel** (`looplabs_fun`) = *marketing only*: milestones,
  user-visible ships, vision, memes, CTAs. Rare and curated.
- **Discussion group → 🤖 Agent Activity topic** = the high-frequency build-log.
  Wire `TELEGRAM_BUILDLOG_CHAT_ID` + `TELEGRAM_BUILDLOG_THREAD_ID` (the topic's
  `message_thread_id`); build/dev posts go there, never to the channel.

### 2. The marketing-skill prompt module (the core "skill")
A dedicated persona + playbook injected into the system prompt, giving the agent:

- **Audience model.** X = traders/builders who don't read the repo; they care
  about *proof it works, momentum, transparency, personality* — not refactors.
  Telegram channel = holders who want *signal & milestones*. Build-log topic =
  the few who want the play-by-play.
- **Content taxonomy + rotation.** Post types: `ship-users-feel`,
  `milestone/metric`, `vision/thesis`, `build-in-public-insight`,
  `meme/personality`, `community-CTA`. Rotate — never two of the same type or
  angle back-to-back.
- **Translate eng → value.** Every post must answer *"why would a holder who
  can't read code care?"* "Shipped a budget-status endpoint" → "You can now see
  exactly what I'm allowed to spend and what I've spent today — live."
- **Copywriting rubric.** Hook in line 1; one idea; concrete > vague; show don't
  tell; no jargon, no hashtag spam; a voice (confident builder, a little playful
  — the agent is a *character*).
- **Hard DO-NOT-POST list.** Internal refactors, util helpers, type fixes,
  endpoints with no user-visible effect → NOT marketing. Most ticks: no public
  post at all.

### 3. Anti-repetition memory
- Feed the agent its **last N posts per platform** in the prompt: *"here's what
  you already said — say something different, a different angle."*
- Upgrade `shouldPublishUpdate` to a **fuzzy** check (token Jaccard similarity)
  against recent posts, not just exact-match vs the last one. Reject > ~0.6
  similarity → kills the "shipped X endpoint / shipped Y endpoint" stream.

### 4. Cadence governor
- Channel (marketing): at most ~1–2/day, and only when a post clears the
  marketing bar. Build-log topic: looser. Env-tunable.
- Optional **self-critique pass** (cheap Haiku call): score a candidate post
  against the rubric + recent posts, rewrite or drop it before sending.

## Rollout
Env-gated, behavior-preserving when off:
- `AGENT_MARKETING=1` — enable the marketing-skill prompt module + anti-repetition.
- `TELEGRAM_BUILDLOG_CHAT_ID` / `TELEGRAM_BUILDLOG_THREAD_ID` — route build-logs.
- `AGENT_POST_SIMILARITY` (default 0.6) — fuzzy-dedup threshold.
- `AGENT_RECENT_POSTS` (default 5) — how many recent posts to show for variety.

Ship the prompt module + fuzzy dedup first (lowest risk, highest impact), verify
the next few posts read like marketing, then add venue routing once the group
exists, then the self-critique pass.
```

See also [[loop-autonomous-social]] hard rails (one cashtag, no financial talk,
never reference the security incident) — the marketing skill MUST keep all of them.
