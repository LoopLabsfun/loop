import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas: "#FCFCFD",
        surface: "#FFFFFF",
        "surface-2": "#FAF9FB",
        "surface-3": "#F5F3F6",
        ink: "#16131A",
        "ink-2": "#2A2531",
        // Text
        body: "#4B4554",
        muted: "#6E6877",
        faint: "#9B95A4",
        ghost: "#B7B2BE",
        // Borders
        line: "#EFEDF1",
        "line-2": "#ECEAEE",
        "line-3": "#E3E0E7",
        "line-4": "#F2F0F4",
        "line-hover": "#C9C4D0",
        // Brand (violet) — kept as oklch via CSS vars
        accent: "var(--accent)",
        "accent-d": "var(--accent-d)",
        "accent-text": "var(--accent-text)",
        "accent-tint": "var(--accent-tint)",
        "accent-tint-border": "var(--accent-tint-border)",
        "accent-200": "var(--accent-200)",
        "accent-300": "var(--accent-300)",
        "accent-400": "var(--accent-400)",
        // Semantic
        pos: "var(--pos)",
        "pos-bright": "var(--pos-bright)",
        neg: "var(--neg)",
        warn: "var(--warn)",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
        sans: [
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      keyframes: {
        loopPulse: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        loopFadeIn: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        loopMarquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        loopSpin: {
          from: { strokeDashoffset: "0" },
          to: { strokeDashoffset: "-81.68" },
        },
        loopSpinR: {
          from: { strokeDashoffset: "81.68" },
          to: { strokeDashoffset: "0" },
        },
        // One continuous dash travelling the whole figure-8 path. Paired with
        // pathLength="100" so the offset is in percent of the total path.
        loopTrace: {
          from: { strokeDashoffset: "0" },
          to: { strokeDashoffset: "-100" },
        },
        // Right-side inspector drawer slide-in.
        loopSlideIn: {
          from: { opacity: "0", transform: "translateX(24px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        // Subtle vertical bob for the agent's ASCII mascot (alive, not busy).
        loopBob: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-2px)" },
        },
        // Gentle breathing scale — the always-on "it's alive" idle/sleep motion.
        loopBreathe: {
          "0%,100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.05)" },
        },
        // Excited little hop for a pumping market.
        loopHop: {
          "0%,100%": { transform: "translateY(0)" },
          "30%": { transform: "translateY(-4px)" },
          "60%": { transform: "translateY(0)" },
        },
        // Slow downward sway for a dumping market.
        loopSink: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(2px)" },
        },
        // Big, gleeful bounce + tilt for a pumping market — the mascot can't sit
        // still when the tape rips. Combines a tall hop with a little wobble.
        loopBoing: {
          "0%,100%": { transform: "translateY(0) rotate(-4deg) scale(1)" },
          "20%": { transform: "translateY(-7px) rotate(5deg) scale(1.08)" },
          "45%": { transform: "translateY(0) rotate(-3deg) scale(0.97)" },
          "65%": { transform: "translateY(-3px) rotate(3deg) scale(1.03)" },
          "85%": { transform: "translateY(0) rotate(-1deg) scale(1)" },
        },
        // Nervous shiver for a dumping/blocked state — small fast horizontal jitter.
        loopShiver: {
          "0%,100%": { transform: "translateX(0) translateY(1px)" },
          "25%": { transform: "translateX(-1.5px) translateY(2px)" },
          "75%": { transform: "translateX(1.5px) translateY(2px)" },
        },
        // A coloured aura that breathes behind the face — the "presence" glow. The
        // colour is set per-mood by a CSS var on the element.
        loopAura: {
          "0%,100%": { opacity: "0.35", transform: "scale(0.92)" },
          "50%": { opacity: "0.85", transform: "scale(1.18)" },
        },
        // Particles rising off the mascot when it's pumping (green $ / ↑).
        loopRise: {
          "0%": { opacity: "0", transform: "translateY(4px) scale(0.6)" },
          "20%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translateY(-18px) scale(1.1)" },
        },
        // Particles falling off the mascot when it's dumping (red ↓).
        loopFall: {
          "0%": { opacity: "0", transform: "translateY(-4px) scale(0.6)" },
          "20%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translateY(16px) scale(1.05)" },
        },
        // A quick twinkle for sparkles around an excited/shipped mascot.
        loopSparkle: {
          "0%,100%": { opacity: "0", transform: "scale(0.4)" },
          "50%": { opacity: "1", transform: "scale(1.15)" },
        },
      },
      animation: {
        pulseLoop: "loopPulse 2s infinite",
        pulseFast: "loopPulse 1.6s infinite",
        pulseTick: "loopPulse 1s infinite",
        fadeIn: "loopFadeIn 0.4s ease",
        fadeInFast: "loopFadeIn 0.3s ease",
        marquee: "loopMarquee 26s linear infinite",
        spinLoop: "loopSpin 2.8s linear infinite",
        spinLoopR: "loopSpinR 2.8s linear infinite",
        traceLoop: "loopTrace 3s linear infinite",
        slideIn: "loopSlideIn 0.28s cubic-bezier(0.22,1,0.36,1)",
        bob: "loopBob 3.2s ease-in-out infinite",
        breathe: "loopBreathe 3.6s ease-in-out infinite",
        hop: "loopHop 1.1s ease-in-out infinite",
        sink: "loopSink 2.4s ease-in-out infinite",
        boing: "loopBoing 0.85s ease-in-out infinite",
        shiver: "loopShiver 0.3s ease-in-out infinite",
        aura: "loopAura 2.6s ease-in-out infinite",
        rise: "loopRise 1.5s ease-out infinite",
        fall: "loopFall 1.6s ease-in infinite",
        sparkle: "loopSparkle 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
