import type { AgentTask } from "./agent";
import type { AgentRunState } from "./budget";

// Pure logic for the agent's ASCII mascot — JSX-free so the state→face mapping is
// unit-testable. The component (components/token/AgentFace.tsx) renders these.
// No theatre over fake data: the mood comes from the same honest signals the
// status badge uses (agentRunState, the budget gate) plus the newest task status.

export type Mood =
  | "presleep"
  | "asleep"
  | "building"
  | "shipped"
  | "blocked"
  | "online"
  | "pumping"
  | "dumping";

/** Pure: the agent's mood from its run-state + the newest task status. */
export function agentMood(
  runState: AgentRunState,
  latestStatus?: AgentTask["status"]
): Mood {
  if (runState === "pre-launch") return "presleep";
  if (runState === "asleep") return "asleep";
  // active (funded): colour the face by what it's actually doing right now.
  if (latestStatus === "blocked") return "blocked";
  if (latestStatus === "building") return "building";
  if (latestStatus === "shipped") return "shipped";
  return "online";
}

/** Live market signals the mascot can react to (so the page feels alive). */
export interface MarketSignal {
  /** Price / market-cap % change over the recent window, e.g. +12 or -9. */
  changePct?: number;
}

// What the agent is DOING always beats the tape: these are never overpainted by a
// market move, so the mascot stops getting stuck on "mcap pumping" while it's
// actually building, shipping, or blocked. Only the idle/sleep states react to
// the chart (it's reacting to the market, not claiming to work).
const WORK_MOODS: ReadonlySet<Mood> = new Set<Mood>(["building", "shipped", "blocked"]);

/**
 * Pure: overlay a LIVE market reaction onto an IDLE base mood, so an idle mascot
 * still feels alive — it reacts to a big move when it's online or asleep (it's
 * reacting to the chart, not claiming to work). Real work/alert states
 * (building/shipped/blocked) are never masked — that's what the agent is doing
 * right now, which matters more than the tape. A big move up → "pumping", a big
 * move down → "dumping". Thresholds tunable.
 */
export function liveMood(
  base: Mood,
  market?: MarketSignal,
  upPct = 8,
  downPct = -8
): Mood {
  if (WORK_MOODS.has(base)) return base; // doing real work / alert — never overpaint
  const c = market?.changePct;
  if (typeof c === "number" && Number.isFinite(c)) {
    if (c >= upPct) return "pumping";
    if (c <= downPct) return "dumping";
  }
  return base;
}

/** The always-on motion for a mood (tailwind `animate-${anim}` class). */
export type FaceAnim = "breathe" | "bob" | "hop" | "sink" | "boing" | "shiver";

/** An emitted-particle effect that surrounds the mascot in a strong mood. */
export type FaceFx = "rise" | "fall" | "sparkle";

export interface Face {
  eyes: string;
  mouth: string;
  caption: string;
  tone: "muted" | "accent" | "pos" | "neg";
  asleep: boolean;
  /** Always set — the mascot is never static; each mood moves its own way. */
  anim: FaceAnim;
  /**
   * Optional particle effect rising/falling/twinkling around the mascot. Set for
   * the loud market moods (rise when pumping, fall when dumping) and on a ship,
   * so a big move is impossible to miss — undefined for the calm states.
   */
  fx?: FaceFx;
  /** Glyph emitted by the particle effect (e.g. "$" rising, "↓" falling). */
  fxGlyph?: string;
}

/** Pure: the ASCII face + caption + motion + market FX for a mood. */
export function faceFor(mood: Mood): Face {
  switch (mood) {
    case "presleep":
      return { eyes: "-   -", mouth: "‿", caption: "dreaming of launch", tone: "muted", asleep: true, anim: "breathe" };
    case "asleep":
      return { eyes: "-   -", mouth: "‿", caption: "asleep · treasury empty", tone: "muted", asleep: true, anim: "breathe" };
    case "building":
      return { eyes: "o   o", mouth: "▾", caption: "heads-down, building", tone: "accent", asleep: false, anim: "bob" };
    case "shipped":
      return { eyes: "^   ^", mouth: "‿", caption: "just shipped ✓", tone: "pos", asleep: false, anim: "hop", fx: "sparkle", fxGlyph: "✦" };
    case "blocked":
      return { eyes: ">   <", mouth: "︵", caption: "blocked — needs a human", tone: "neg", asleep: false, anim: "shiver" };
    case "online":
      return { eyes: "•   •", mouth: "‿", caption: "online", tone: "accent", asleep: false, anim: "bob" };
    case "pumping":
      return { eyes: "$   $", mouth: "◡", caption: "mcap pumping ↑", tone: "pos", asleep: false, anim: "boing", fx: "rise", fxGlyph: "$" };
    case "dumping":
      return { eyes: "ⓧ   ⓧ", mouth: "︵", caption: "red tape — heads down", tone: "neg", asleep: false, anim: "shiver", fx: "fall", fxGlyph: "↓" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VOICE — short first-person lines the mascot "says" (speech bubble on hover /
// click). They make it feel like a character with an inner life instead of a
// static status glyph, and — crucially — let it describe what it's actually
// doing. Honest by construction: each line matches the same mood the face shows.
// ─────────────────────────────────────────────────────────────────────────────
export const MOOD_QUIPS: Record<Mood, string[]> = {
  presleep: ["warming up the engine…", "any minute now", "dreaming in commits"],
  asleep: ["out of fuel — fund me?", "zzz… treasury's empty", "buy me awake"],
  building: ["heads-down, shipping", "compiling the future", "give me a sec…"],
  shipped: ["just shipped ✓", "that's live now", "next!"],
  blocked: ["stuck — need a human", "founder call needed", "can't clear this solo"],
  online: ["watching the tape", "what should we build?", "ask me anything"],
  pumping: ["we're ripping ↑", "mcap go brrr", "green day 😎"],
  dumping: ["rough tape — heads down", "riding it out", "we keep building"],
};

/**
 * Pure: the line the mascot "says" for a mood. When it's building and there's a
 * real current task, it says what it's literally working on (so the character is
 * wired to the agent, not faking it). `seed` rotates the canned quips so repeated
 * pokes don't repeat the same line.
 */
export function speak(mood: Mood, opts?: { taskTitle?: string; seed?: number }): string {
  const title = opts?.taskTitle?.trim();
  if (mood === "building" && title) {
    const short = title.length > 42 ? title.slice(0, 41).trimEnd() + "…" : title;
    return `on it: ${short}`;
  }
  if (mood === "blocked" && title) {
    const short = title.length > 42 ? title.slice(0, 41).trimEnd() + "…" : title;
    return `blocked on: ${short}`;
  }
  const lines = MOOD_QUIPS[mood];
  const i = ((opts?.seed ?? 0) % lines.length + lines.length) % lines.length;
  return lines[i];
}

export const TONE_TEXT: Record<Face["tone"], string> = {
  muted: "text-faint",
  accent: "text-accent-text",
  pos: "text-pos",
  neg: "text-neg",
};

/** The presence-glow colour behind the mascot, per tone (a theme CSS var). */
export const TONE_AURA: Record<Face["tone"], string> = {
  muted: "var(--accent-200)",
  accent: "var(--accent-400)",
  pos: "var(--pos-bright)",
  neg: "var(--neg)",
};

// Full literal class names (not built via `animate-${x}`) so Tailwind's purge
// keeps them in the production build.
export const ANIM_CLASS: Record<FaceAnim, string> = {
  breathe: "animate-breathe",
  bob: "animate-bob",
  hop: "animate-hop",
  sink: "animate-sink",
  boing: "animate-boing",
  shiver: "animate-shiver",
};

/** Literal particle-animation classes (kept whole for Tailwind's purge). */
export const FX_CLASS: Record<FaceFx, string> = {
  rise: "animate-rise",
  fall: "animate-fall",
  sparkle: "animate-sparkle",
};
