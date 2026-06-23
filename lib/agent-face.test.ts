import { describe, it, expect } from "vitest";
import { agentMood, liveMood, faceFor, speak, MOOD_QUIPS, type Mood } from "./agent-face";

describe("agentMood", () => {
  it("sleeps before launch and when the treasury can't afford a tick", () => {
    expect(agentMood("pre-launch")).toBe("presleep");
    expect(agentMood("asleep")).toBe("asleep");
    // run-state wins over task status — an unfunded agent is asleep, period.
    expect(agentMood("asleep", "building")).toBe("asleep");
  });

  it("colours an active agent by its newest task", () => {
    expect(agentMood("active", "blocked")).toBe("blocked");
    expect(agentMood("active", "building")).toBe("building");
    expect(agentMood("active", "shipped")).toBe("shipped");
    expect(agentMood("active", "todo")).toBe("online");
    expect(agentMood("active")).toBe("online");
  });
});

describe("faceFor", () => {
  it("sleeping moods carry the asleep flag; awake ones don't", () => {
    expect(faceFor("asleep").asleep).toBe(true);
    expect(faceFor("presleep").asleep).toBe(true);
    expect(faceFor("building").asleep).toBe(false);
  });

  it("ships happy (pos), blocks worried (neg)", () => {
    expect(faceFor("shipped").tone).toBe("pos");
    expect(faceFor("blocked").tone).toBe("neg");
  });

  it("every mood yields a caption + eyes + mouth", () => {
    const moods: Mood[] = [
      "presleep",
      "asleep",
      "building",
      "shipped",
      "blocked",
      "online",
      "pumping",
      "dumping",
    ];
    for (const m of moods) {
      const f = faceFor(m);
      expect(f.caption.length).toBeGreaterThan(0);
      expect(f.eyes.length).toBeGreaterThan(0);
      expect(f.mouth.length).toBeGreaterThan(0);
      // never static — every mood carries an always-on motion
      expect(["breathe", "bob", "hop", "sink", "boing", "shiver"]).toContain(f.anim);
    }
  });

  it("fires a market particle effect on the loud moods", () => {
    expect(faceFor("pumping").fx).toBe("rise");
    expect(faceFor("dumping").fx).toBe("fall");
    expect(faceFor("shipped").fx).toBe("sparkle");
    // the calm states stay particle-free
    expect(faceFor("online").fx).toBeUndefined();
    expect(faceFor("asleep").fx).toBeUndefined();
  });
});

describe("liveMood (market overlay)", () => {
  it("reacts to a big move only in idle/sleep states (online/asleep)", () => {
    expect(liveMood("online", { changePct: 12 })).toBe("pumping");
    expect(liveMood("online", { changePct: -12 })).toBe("dumping");
    expect(liveMood("asleep", { changePct: 99 })).toBe("pumping"); // reacts even asleep
  });
  it("never overpaints what the agent is DOING (building/shipped/blocked)", () => {
    // The core fix: it no longer gets stuck on "mcap pumping" while working.
    expect(liveMood("building", { changePct: 50 })).toBe("building");
    expect(liveMood("shipped", { changePct: -50 })).toBe("shipped");
    expect(liveMood("blocked", { changePct: 99 })).toBe("blocked"); // real alert wins
  });
  it("keeps the base mood on a small/absent move", () => {
    expect(liveMood("online", { changePct: 2 })).toBe("online"); // small move = calm
    expect(liveMood("asleep", { changePct: 2 })).toBe("asleep");
    expect(liveMood("online")).toBe("online"); // no signal
  });
  it("honors custom thresholds and ignores non-finite input", () => {
    expect(liveMood("online", { changePct: 5 }, 4, -4)).toBe("pumping");
    expect(liveMood("online", { changePct: NaN })).toBe("online");
  });
});

describe("speak (mascot voice)", () => {
  it("says the actual task when building, so it's wired to the real agent", () => {
    expect(speak("building", { taskTitle: "Ship the expense ledger" })).toBe(
      "on it: Ship the expense ledger"
    );
    expect(speak("blocked", { taskTitle: "Rotate the over-scoped PAT" })).toBe(
      "blocked on: Rotate the over-scoped PAT"
    );
  });
  it("truncates a long task title", () => {
    const long = "x".repeat(80);
    const out = speak("building", { taskTitle: long });
    expect(out.length).toBeLessThanOrEqual("on it: ".length + 42);
    expect(out.endsWith("…")).toBe(true);
  });
  it("falls back to a canned quip with no task, rotating by seed", () => {
    const a = speak("online", { seed: 0 });
    const b = speak("online", { seed: 1 });
    expect(a).not.toBe(b);
    // seed wraps and is stable
    expect(speak("online", { seed: 3 })).toBe(speak("online", { seed: 0 }));
  });
  it("ignores an empty task title", () => {
    expect(speak("building", { taskTitle: "   " })).toBe(MOOD_QUIPS.building[0]);
  });
});
