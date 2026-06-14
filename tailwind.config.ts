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
      },
    },
  },
  plugins: [],
};

export default config;
