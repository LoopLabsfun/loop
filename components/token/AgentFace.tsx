"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentTask } from "@/lib/agent";
import { agentRunState } from "@/lib/budget";
import {
  agentMood,
  liveMood,
  faceFor,
  speak,
  TONE_TEXT,
  TONE_AURA,
  ANIM_CLASS,
  FX_CLASS,
  type MarketSignal,
} from "@/lib/agent-face";
import type { Project } from "@/lib/types";

// The agent's ASCII mascot — a tiny character that REACTS to the agent's real
// state and the live market. The state→face mapping is pure (lib/agent-face.ts);
// this renders it as a LIVING thing: an always-breathing presence aura behind
// the face, mood-specific motion (an excited boing when the tape rips, a nervous
// shiver when it bleeds), emitted particles ($ rising on a pump, ↓ falling on a
// dump, ✦ twinkling on a ship), and a randomised eye-blink. It moves in every
// state — it never just sits there.

export function AgentFace({
  project: p,
  tasks = [],
  size = "md",
  caption: showCaption = true,
  market,
}: {
  project: Project;
  tasks?: AgentTask[];
  size?: "sm" | "md" | "lg";
  caption?: boolean;
  /** Live market signal (e.g. mcap % change) so the idle mascot reacts. */
  market?: MarketSignal;
}) {
  const runState = agentRunState(p);
  const mood = liveMood(agentMood(runState, tasks[0]?.status), market);
  const f = faceFor(mood);

  // Blink — periodically close the eyes for a beat so the mascot always reads as
  // alive (skipped while asleep, whose eyes are already shut). Random cadence so
  // it never looks metronomic.
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (f.asleep) return;
    let timer: ReturnType<typeof setTimeout>;
    const blink = () => {
      setBlinking(true);
      setTimeout(() => setBlinking(false), 130);
    };
    const schedule = () => {
      timer = setTimeout(() => {
        blink();
        // ~30% of the time a quick second blink — natural, never metronomic.
        if (Math.random() < 0.3) setTimeout(blink, 280);
        schedule();
      }, 2400 + Math.random() * 2800);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [f.asleep]);

  // Ambient life: every so often the mascot has a "thought" and shows a quip on
  // its own — so it feels alive even when you're not poking it. Gentle cadence,
  // skipped while asleep or while you're already hovering it.
  const [spontaneous, setSpontaneous] = useState(false);
  const [spontSeed, setSpontSeed] = useState(1);
  useEffect(() => {
    if (f.asleep) return;
    let hide: ReturnType<typeof setTimeout>;
    let next: ReturnType<typeof setTimeout>;
    const tick = () => {
      next = setTimeout(() => {
        setSpontSeed((n) => n + 1);
        setSpontaneous(true);
        hide = setTimeout(() => setSpontaneous(false), 2600);
        tick();
      }, 14000 + Math.random() * 12000);
    };
    tick();
    return () => {
      clearTimeout(next);
      clearTimeout(hide);
    };
  }, [f.asleep]);

  // Interactivity — the mascot TALKS. Hovering (or tapping) opens a speech bubble
  // with a first-person line; on "build" it says the actual current task, so the
  // character is wired to the real agent. Poking (click) makes it react — a quick
  // hop + a fresh quip — and the bubble lingers a beat after the cursor leaves.
  const [hovered, setHovered] = useState(false);
  const [poke, setPoke] = useState(0); // bumps on click → next quip + replay anim
  const [poked, setPoked] = useState(false); // brief "!" + extra bounce after a click
  const pokeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lingering, setLingering] = useState(false);
  useEffect(
    () => () => {
      if (pokeTimer.current) clearTimeout(pokeTimer.current);
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    },
    []
  );

  const onPoke = () => {
    setPoke((n) => n + 1);
    setPoked(true);
    if (pokeTimer.current) clearTimeout(pokeTimer.current);
    pokeTimer.current = setTimeout(() => setPoked(false), 520);
    // keep the bubble up for a moment after a tap (so it works on touch)
    setLingering(true);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setLingering(false), 2200);
  };

  const bubbleOpen = hovered || lingering || spontaneous;
  const line = speak(mood, { taskTitle: tasks[0]?.title, seed: poke + spontSeed });
  // Curious wide eyes while hovered (unless mid-blink / asleep) — a small "noticed
  // you" tell that makes the interaction feel responsive.
  const eyes = blinking ? "—   —" : hovered && !f.asleep ? "◉   ◉" : f.eyes;
  const box =
    size === "lg"
      ? "w-[72px] h-[64px] text-[18px]"
      : size === "sm"
        ? "w-[44px] h-[40px] text-[12px]"
        : "w-[56px] h-[50px] text-[14px]";

  const aura = TONE_AURA[f.tone];
  // Particles ride above (rise) / below (fall) the face; sparkles ring it.
  const fxGlyphs = f.fx
    ? f.fx === "sparkle"
      ? [
          { glyph: f.fxGlyph ?? "✦", left: "-8%", top: "0%", delay: "0s" },
          { glyph: f.fxGlyph ?? "✦", left: "92%", top: "30%", delay: "0.5s" },
          { glyph: f.fxGlyph ?? "✦", left: "78%", top: "-12%", delay: "0.9s" },
        ]
      : [
          { glyph: f.fxGlyph ?? "•", left: "8%", top: "50%", delay: "0s" },
          { glyph: f.fxGlyph ?? "•", left: "46%", top: "50%", delay: "0.5s" },
          { glyph: f.fxGlyph ?? "•", left: "82%", top: "50%", delay: "0.9s" },
        ]
    : [];

  return (
    <div className="flex items-center gap-[10px]" title={`Agent · ${f.caption}`}>
      <button
        type="button"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onPoke}
        aria-label={`Agent mascot — ${f.caption}. Tap to poke.`}
        className="relative flex items-center justify-center cursor-pointer bg-transparent border-0 p-0 transition-transform duration-150 hover:scale-[1.06] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[12px]"
      >
        {/* Speech bubble — the mascot talks: a first-person line on hover/tap. */}
        <span
          role="status"
          className={`absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-[8px] whitespace-nowrap px-[9px] py-[5px] rounded-[8px] border border-line-2 bg-surface shadow-sm font-mono text-[10.5px] ${TONE_TEXT[f.tone]} transition-all duration-150 origin-bottom pointer-events-none ${
            bubbleOpen ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-[3px] scale-95"
          }`}
        >
          {line}
          {/* little tail */}
          <span
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 top-full w-[7px] h-[7px] -mt-[4px] rotate-45 bg-surface border-r border-b border-line-2"
          />
        </span>

        {/* Poke spark — a quick "!" pops when tapped. */}
        {poked && (
          <span
            aria-hidden
            className={`absolute z-20 -top-[2px] right-[2px] font-mono text-[12px] ${TONE_TEXT[f.tone]} animate-hop`}
          >
            !
          </span>
        )}

        {/* Presence aura — always breathing behind the face, coloured by mood. */}
        <span
          aria-hidden
          className="absolute inset-[-7px] rounded-[14px] animate-aura blur-[7px] pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${aura} 0%, transparent 70%)`,
          }}
        />

        {/* Emitted particles — the unmissable market reaction. */}
        {fxGlyphs.map((s, i) => (
          <span
            key={i}
            aria-hidden
            className={`absolute z-10 font-mono ${size === "lg" ? "text-[13px]" : "text-[10px]"} ${TONE_TEXT[f.tone]} ${FX_CLASS[f.fx!]} pointer-events-none`}
            style={{ left: s.left, top: s.top, animationDelay: s.delay }}
          >
            {s.glyph}
          </span>
        ))}

        <div
          className={`${box} ${poked ? "animate-boing" : ANIM_CLASS[f.anim]} relative z-[1] flex flex-col items-center justify-center rounded-[10px] border ${hovered ? "border-accent" : "border-line-2"} bg-accent-tint font-mono leading-none select-none transition-colors`}
          aria-hidden
        >
          <span className={`${TONE_TEXT[f.tone]} transition-all`}>{eyes}</span>
          <span className={`${TONE_TEXT[f.tone]} mt-[3px]`}>{f.mouth}</span>
          {/* Body + arms — a posture per mood (arms up on a pump, slumped on a
              dump, typing while building). Subtle so the eyes/mouth stay primary. */}
          <span className={`${TONE_TEXT[f.tone]} mt-[3px] opacity-60`}>{f.arms}</span>
          {f.asleep && (
            <span className="absolute -top-[6px] -right-[3px] text-[10px] text-faint animate-pulseLoop">
              z
            </span>
          )}
        </div>
      </button>
      {showCaption && (
        <span className={`font-mono text-[11.5px] ${TONE_TEXT[f.tone]}`}>{f.caption}</span>
      )}
    </div>
  );
}
