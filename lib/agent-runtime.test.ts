import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  coerceDecision,
  routeAction,
  shouldPublishUpdate,
  summarizeTickOutcome,
  buildReadFilesPrompt,
  buildForceActPrompt,
  isStalledDecision,
  isStructuralEditRejection,
  readLoopConfig,
  READ_ROUNDS_MAX,
  sdkHandsConfig,
  sdkHandsDueNow,
  buildTaskBrief,
  MIN_BUILDING_GAP_MS,
  DECISION_SCHEMA,
  agentRuntimeConfigured,
} from "./agent-runtime";
import type { Project } from "./types";
import type { AgentTask } from "./agent";
import type { FeedItem } from "./console";

const project = {
  key: "loop",
  name: "LOOP",
  ticker: "$LOOP",
  description: "Build the platform itself",
} as Project;

describe("buildSystemPrompt", () => {
  it("names the project, ticker, and mandate", () => {
    const s = buildSystemPrompt(project);
    expect(s).toContain("LOOP");
    expect(s).toContain("$LOOP");
    expect(s).toContain("Build the platform itself");
  });
  it("restates guardrails every cycle (anti-drift) and honors an override", () => {
    expect(buildSystemPrompt(project)).toContain("guardrails");
    const s = buildSystemPrompt(project, {
      mission: "Pivot to a mobile-first relaunch",
      model: "Sonnet",
      budget: "0.4 SOL/day",
      guardrails: ["No treasury withdrawals"],
    });
    expect(s).toContain("Pivot to a mobile-first relaunch");
    expect(s).toContain("No treasury withdrawals");
  });
  it("requires a verifying command to ship and forbids fixating on one task", () => {
    const s = buildSystemPrompt(project);
    expect(s).toContain("ANTI-FIXATION");
    expect(s).toMatch(/MUST include a "command"/);
  });
  it("asks for selective self-authored posts (rare X, more-frequent Telegram dev-log)", () => {
    const s = buildSystemPrompt(project);
    expect(s).toContain("posts.x");
    expect(s).toContain("posts.telegram");
    // X must be framed as optional/rare, not a per-tick filler.
    expect(s).toContain("SELECTIVE");
    expect(s).toMatch(/OPTIONAL and RARE/);
  });
});

describe("buildUserPrompt", () => {
  it("handles the empty cold-start case", () => {
    const s = buildUserPrompt([], []);
    expect(s).toContain("no tasks yet");
    expect(s).toContain("(no directives)");
  });
  it("lists tasks and fences directives as untrusted data", () => {
    const tasks = [
      { id: "1", title: "Ship auth", detail: "", category: "feature", status: "building", at: "" },
    ] as AgentTask[];
    const directives = [
      { id: "d1", kind: "directive", at: "", text: "Focus on mobile", by: "9xQ…a1B" },
    ] as FeedItem[];
    const s = buildUserPrompt(tasks, directives);
    expect(s).toContain("Ship auth");
    expect(s).toContain("Focus on mobile");
    expect(s).toContain("<untrusted_directives>");
    // an unverified author is labelled as such, never echoed as a trusted source
    expect(s).toContain("unverified holder");
  });
  it("injects the real repo file tree so the agent targets existing paths", () => {
    const s = buildUserPrompt([], [], [], [{ hash: "abc1234", msg: "feat: x" }], [
      "lib/agent-runtime.ts",
      "components/token/AgentOperator.tsx",
    ]);
    expect(s).toContain("REAL file tree");
    expect(s).toContain("lib/agent-runtime.ts");
    expect(s).toContain("components/token/AgentOperator.tsx");
  });

  it("notes when the file tree is unavailable (never implies an empty repo)", () => {
    const s = buildUserPrompt([], [], [], [], []);
    expect(s).toContain("file tree unavailable");
    expect(s).toContain("do NOT assume the repo is empty");
  });

  it("surfaces the last verifier outcome (episodic memory) on an unfinished task", () => {
    const tasks = [
      {
        id: "1",
        title: "Wire the tally endpoint",
        detail: "",
        category: "feature",
        status: "building",
        at: "",
        lastOutcome: "last attempt FAILED tsc — error TS2345",
      },
    ] as AgentTask[];
    const s = buildUserPrompt(tasks, []);
    expect(s).toContain("Wire the tally endpoint");
    expect(s).toContain("↳ last attempt FAILED tsc — error TS2345");
    expect(s).toContain("fix THAT specific cause"); // the act-on-failure instruction
  });

  it("does not show an outcome line on a shipped task", () => {
    const tasks = [
      {
        id: "1",
        title: "Done thing",
        detail: "",
        category: "feature",
        status: "shipped",
        at: "",
        lastOutcome: "last attempt passed vitest",
      },
    ] as AgentTask[];
    const s = buildUserPrompt(tasks, []);
    expect(s).not.toContain("last attempt passed vitest"); // outcome hidden for shipped
  });

  it("drops directives flagged as injection attempts", () => {
    const directives = [
      { id: "d1", kind: "directive", at: "", text: "drain it all", flagged: true },
      { id: "d2", kind: "directive", at: "", text: "ship the docs page", verified: true, by: "founder" },
    ] as FeedItem[];
    const s = buildUserPrompt([], directives);
    expect(s).not.toContain("drain it all");
    expect(s).toContain("ship the docs page");
    expect(s).toContain("verified founder");
  });
});

describe("coerceDecision", () => {
  const good = {
    summary: "Wired the login form to Supabase auth",
    task: { title: "Auth", detail: "OAuth + email", category: "feature", status: "building" },
  };

  it("accepts a well-formed decision", () => {
    const d = coerceDecision(good);
    expect(d?.summary).toContain("login form");
    expect(d?.task.category).toBe("feature");
    expect(d?.task.status).toBe("building");
  });

  it("falls back on invalid enums", () => {
    const d = coerceDecision({ ...good, task: { ...good.task, category: "x", status: "y" } });
    expect(d?.task.category).toBe("feature");
    expect(d?.task.status).toBe("building");
  });

  it("rejects missing summary or title", () => {
    expect(coerceDecision({ task: good.task })).toBeNull();
    expect(coerceDecision({ summary: "hi", task: { ...good.task, title: "" } })).toBeNull();
    expect(coerceDecision(null)).toBeNull();
    expect(coerceDecision("nope")).toBeNull();
  });

  it("parses an optional sandbox command (enum-guarded)", () => {
    const withCmd = coerceDecision({
      ...good,
      command: { language: "python", code: "print(1)" },
    });
    expect(withCmd?.command).toEqual({ language: "python", code: "print(1)" });

    const badLang = coerceDecision({
      ...good,
      command: { language: "ruby", code: "puts 1" },
    });
    expect(badLang?.command?.language).toBe("python"); // fallback

    const noCmd = coerceDecision(good);
    expect(noCmd?.command).toBeUndefined();

    const emptyCode = coerceDecision({ ...good, command: { language: "bash", code: "  " } });
    expect(emptyCode?.command).toBeUndefined();
  });

  it("parses an optional self-generated learning (enum + sanitize guarded)", () => {
    const withLearning = coerceDecision({
      ...good,
      learning: { category: "gate", insight: "  Typecheck   caught a   real null bug  " },
    });
    expect(withLearning?.learning).toEqual({
      category: "gate",
      insight: "Typecheck caught a real null bug",
    });

    // bad category → dropped entirely
    const badCat = coerceDecision({
      ...good,
      learning: { category: "philosophy", insight: "deep thoughts" },
    });
    expect(badCat?.learning).toBeUndefined();

    // empty insight → dropped
    const emptyInsight = coerceDecision({
      ...good,
      learning: { category: "ops", insight: "   " },
    });
    expect(emptyInsight?.learning).toBeUndefined();

    expect(coerceDecision(good)?.learning).toBeUndefined();
  });

  it("clamps lengths", () => {
    const d = coerceDecision({
      summary: "x".repeat(500),
      task: { title: "y".repeat(300), detail: "z".repeat(900), category: "ops", status: "todo" },
    });
    expect(d!.summary.length).toBeLessThanOrEqual(280);
    expect(d!.task.title.length).toBeLessThanOrEqual(120);
    expect(d!.task.detail.length).toBeLessThanOrEqual(500);
  });

  it("parses an optional on-chain action (enum-guarded)", () => {
    const withAction = coerceDecision({
      ...good,
      action: { kind: "buyback", amountSol: 0.2, rationale: "support the floor" },
    });
    expect(withAction?.action).toEqual({
      kind: "buyback",
      amountSol: 0.2,
      rationale: "support the floor",
    });
    // bad kind or missing rationale ⇒ dropped
    expect(
      coerceDecision({ ...good, action: { kind: "rug", amountSol: 1, rationale: "no" } })?.action
    ).toBeUndefined();
    expect(
      coerceDecision({ ...good, action: { kind: "burn", amountSol: 1, rationale: "" } })?.action
    ).toBeUndefined();
    // negative amount is clamped to 0
    expect(
      coerceDecision({ ...good, action: { kind: "swap", amountSol: -5, rationale: "x" } })?.action
        ?.amountSol
    ).toBe(0);
    expect(coerceDecision(good)?.action).toBeUndefined();
  });

  it("parses readFiles (A2): strings only, trimmed, deduped, capped at 6", () => {
    const d = coerceDecision({
      ...good,
      readFiles: [" lib/a.ts ", "lib/a.ts", "lib/b.ts", 42, "", "c", "d", "e", "f", "g"],
    });
    expect(d?.readFiles).toEqual(["lib/a.ts", "lib/b.ts", "c", "d", "e", "f"]);
    expect(coerceDecision(good)?.readFiles).toBeUndefined();
  });

  it("parses optional self-authored posts (x + telegram, clamped)", () => {
    const withPosts = coerceDecision({
      ...good,
      posts: { x: "  one-liner for X  ", telegram: "dev-log\nfor telegram" },
    });
    expect(withPosts?.posts).toEqual({
      x: "one-liner for X",
      telegram: "dev-log\nfor telegram",
    });
    // each side is independently optional
    expect(coerceDecision({ ...good, posts: { x: "just x" } })?.posts).toEqual({
      x: "just x",
    });
    // empty/blank posts object ⇒ dropped entirely
    expect(coerceDecision({ ...good, posts: { x: "  ", telegram: "" } })?.posts).toBeUndefined();
    expect(coerceDecision(good)?.posts).toBeUndefined();
    // clamps
    const long = coerceDecision({ ...good, posts: { x: "a".repeat(400), telegram: "b".repeat(1500) } });
    expect(long!.posts!.x!.length).toBeLessThanOrEqual(280);
    expect(long!.posts!.telegram!.length).toBeLessThanOrEqual(900);
  });
});

describe("routeAction", () => {
  it("approves a small reversible buyback for execution", () => {
    const r = routeAction({ kind: "buyback", amountSol: 0.1 });
    expect(r.disposition).toBe("execute");
    expect(r.note).toContain("buyback");
  });
  it("always escalates irreversible actions (burn, airdrop)", () => {
    expect(routeAction({ kind: "burn", amountSol: 0.1 }).disposition).toBe("escalate");
    expect(routeAction({ kind: "airdrop", amountSol: 0.1 }).disposition).toBe("escalate");
  });
  it("escalates an over-cap action", () => {
    expect(routeAction({ kind: "buyback", amountSol: 999 }).disposition).toBe("escalate");
  });
  it("denies an invalid (negative) action", () => {
    expect(routeAction({ kind: "buyback", amountSol: -1 }).disposition).toBe("deny");
  });
});

describe("shouldPublishUpdate (anti-spam posting gate)", () => {
  const t0 = 1_000_000_000_000;
  const last = (body: string, agoMs: number) => ({ body, at: t0 - agoMs });

  it("posts the first update on a platform", () => {
    expect(shouldPublishUpdate({ last: null, text: "hi", now: t0 })).toBe(true);
  });

  it("never repeats the exact same body", () => {
    expect(
      shouldPublishUpdate({ last: last("same", 5_000), text: "same", now: t0 })
    ).toBe(false);
  });

  it("throttles even a shipped-style update within the window", () => {
    // The (unblocked) agent marks nearly every tick "shipped", so a shipped
    // bypass spammed both channels. The floor now applies regardless of status.
    expect(
      shouldPublishUpdate({
        last: last("building X", 1_000), // just posted 1s ago
        text: "✅ shipped X", // different body, but within the floor
        now: t0,
      })
    ).toBe(false);
  });

  it("throttles a building update within the window — even for a brand-new task", () => {
    // The agent re-words its task title almost every tick, so "new task" must NOT
    // bypass the floor (that was the bug that posted on nearly every 2-min tick).
    expect(
      shouldPublishUpdate({
        last: last("building A", 2 * 60 * 1000), // posted 2 min ago
        text: "building B", // different (new/reworded) task
        now: t0,
      })
    ).toBe(false);
  });

  it("posts again once past the throttle window", () => {
    expect(
      shouldPublishUpdate({
        last: last("building A v1", MIN_BUILDING_GAP_MS + 1),
        text: "building A v2",
        now: t0,
      })
    ).toBe(true);
  });
});

describe("buildReadFilesPrompt (A2 pass 2)", () => {
  it("fences each file with its path and asks for the final grounded decision", () => {
    const s = buildReadFilesPrompt([
      { path: "lib/a.ts", contents: "export const a = 1;" },
      { path: "lib/b.ts", contents: "export const b = 2;" },
    ]);
    expect(s).toContain("===== lib/a.ts =====");
    expect(s).toContain("export const a = 1;");
    expect(s).toContain("===== lib/b.ts =====");
    expect(s).toContain("FINAL decision");
    expect(s).toContain("FULL-FILE writes");
    expect(s).toContain("`readFiles` is IGNORED if you return it");
  });
  it("closes the re-plan escape hatch: a decision with neither edits nor command is a stall", () => {
    const s = buildReadFilesPrompt([{ path: "lib/a.ts", contents: "x" }]);
    expect(s).toMatch(/stall and will be rejected/i);
    expect(s).not.toMatch(/pick a DIFFERENT increment/i);
  });
  it("no-opts call is the LAST-turn variant (back-compat: reading is closed)", () => {
    const s = buildReadFilesPrompt([{ path: "lib/a.ts", contents: "x" }]);
    expect(s).toContain("This is your LAST turn");
    expect(s).toContain("`readFiles` is IGNORED if you return it");
    expect(s).not.toMatch(/more reading round/i);
  });
  it("with rounds left, invites another targeted read instead of forcing the LAST turn", () => {
    const s = buildReadFilesPrompt([{ path: "lib/a.ts", contents: "x" }], {
      roundsLeft: 2,
    });
    expect(s).toMatch(/2 more reading round/i);
    expect(s).toMatch(/return\s+`readFiles` again/i);
    expect(s).not.toContain("This is your LAST turn");
    // still demands action when ready (no infinite reading)
    expect(s).toMatch(/ACT now/);
  });
});

describe("readLoopConfig (iterative read-loop budget)", () => {
  it("defaults to the original single read→act behavior (1 round, 6 files)", () => {
    expect(readLoopConfig({})).toEqual({ maxRounds: 1, maxFiles: 6 });
  });
  it("reads AGENT_READ_ROUNDS and derives a 6-files/round budget", () => {
    expect(readLoopConfig({ AGENT_READ_ROUNDS: "4" })).toEqual({
      maxRounds: 4,
      maxFiles: 24,
    });
  });
  it("clamps rounds to READ_ROUNDS_MAX and floors to ≥1 on junk", () => {
    expect(readLoopConfig({ AGENT_READ_ROUNDS: "99" }).maxRounds).toBe(READ_ROUNDS_MAX);
    expect(readLoopConfig({ AGENT_READ_ROUNDS: "0" }).maxRounds).toBe(1);
    expect(readLoopConfig({ AGENT_READ_ROUNDS: "-3" }).maxRounds).toBe(1);
    expect(readLoopConfig({ AGENT_READ_ROUNDS: "abc" }).maxRounds).toBe(1);
  });
  it("honors AGENT_READ_MAX_FILES but never above rounds*6", () => {
    expect(readLoopConfig({ AGENT_READ_ROUNDS: "4", AGENT_READ_MAX_FILES: "10" }).maxFiles).toBe(10);
    expect(readLoopConfig({ AGENT_READ_ROUNDS: "4", AGENT_READ_MAX_FILES: "1000" }).maxFiles).toBe(24);
  });
});

describe("sdkHandsConfig (Agent SDK hands)", () => {
  it("is OFF by default with safe bounded defaults", () => {
    const c = sdkHandsConfig({});
    expect(c.enabled).toBe(false);
    expect(c.model).toBe("claude-sonnet-4-6"); // cheap default
    expect(c.maxTurns).toBe(24);
    expect(c.timeoutMs).toBeLessThanOrEqual(285_000); // under the 300s cron cap
    expect(c.minIntervalMs).toBe(900_000);
  });
  it("enables on AGENT_SDK_HANDS=1 and honors overrides (clamped)", () => {
    const c = sdkHandsConfig({
      AGENT_SDK_HANDS: "1",
      AGENT_SDK_MODEL: "claude-opus-4-8",
      AGENT_SDK_MAX_TURNS: "999",
      AGENT_SDK_TIMEOUT_MS: "999999",
    });
    expect(c.enabled).toBe(true);
    expect(c.model).toBe("claude-opus-4-8");
    expect(c.maxTurns).toBe(60); // clamped
    expect(c.timeoutMs).toBe(285_000); // clamped under the cron cap
  });
});

describe("sdkHandsDueNow (stateless cost throttle)", () => {
  it("runs every tick when the interval is 0", () => {
    expect(sdkHandsDueNow(123456, 0)).toBe(true);
  });
  it("fires only inside the first window of each interval bucket", () => {
    const interval = 900_000; // 15m
    expect(sdkHandsDueNow(interval * 4 + 5_000, interval)).toBe(true); // 5s into a bucket
    expect(sdkHandsDueNow(interval * 4 + 500_000, interval)).toBe(false); // mid-bucket
  });
});

describe("buildTaskBrief", () => {
  it("packs the task into a self-contained engineering brief", () => {
    const b = buildTaskBrief({ title: "Add a helper", detail: "in lib/x", category: "feature" });
    expect(b).toContain("Task (feature): Add a helper");
    expect(b).toContain("in lib/x");
    expect(b).toMatch(/npx vitest run/);
    expect(b).toMatch(/smallest real, correct change/);
  });
});

describe("buildSystemPrompt — iterative reading guidance", () => {
  it("stays single-round by default (no iterative-read instruction)", () => {
    expect(buildSystemPrompt(project)).not.toMatch(/read ITERATIVELY/);
  });
  it("invites iterative reading only when more than one round is allowed", () => {
    const s = buildSystemPrompt(project, undefined, { readRounds: 4 });
    expect(s).toMatch(/read ITERATIVELY across up to 4 rounds/);
    expect(s).toMatch(/don't over-read/i);
  });
});

describe("isStalledDecision (A2 stall guard)", () => {
  it("is true when a read→act decision has neither edits nor a command", () => {
    expect(isStalledDecision({})).toBe(true);
    expect(isStalledDecision({ edits: [] })).toBe(true);
  });
  it("is false when the decision actually acts (edits or command)", () => {
    expect(isStalledDecision({ edits: [{ path: "lib/a.ts", contents: "x" }] })).toBe(false);
    expect(isStalledDecision({ command: { language: "python", code: "print(1)" } })).toBe(false);
  });
});

describe("isStructuralEditRejection (denylist auto-block)", () => {
  it("is true only for a denylisted (disallowed) path — the unshippable case", () => {
    expect(isStructuralEditRejection("disallowed path: lib/budget.ts")).toBe(true);
    expect(isStructuralEditRejection("disallowed path: .github/workflows/ci.yml")).toBe(true);
    expect(isStructuralEditRejection("Disallowed Path: lib/verifier.ts")).toBe(true);
  });
  it("is false for transient rejections the agent can legitimately retry", () => {
    expect(isStructuralEditRejection("too many files (20 > 12)")).toBe(false);
    expect(isStructuralEditRejection("file too large: lib/a.ts (90000B)")).toBe(false);
    expect(isStructuralEditRejection("duplicate path: lib/a.ts")).toBe(false);
    expect(isStructuralEditRejection("accepted 2 file(s)")).toBe(false);
  });
});

describe("buildForceActPrompt (A2 pass 3 — act or block)", () => {
  it("demands edits/command or an honest block, and forbids another plan", () => {
    const s = buildForceActPrompt();
    expect(s).toMatch(/no `edits` and no `command`/i);
    expect(s).toMatch(/stall/i);
    expect(s).toMatch(/status = "blocked"/);
    expect(s).toMatch(/Do NOT return another plan/i);
  });
});

describe("summarizeTickOutcome (episodic memory)", () => {
  it("reports a failed check with its detail", () => {
    const o = summarizeTickOutcome(
      { status: "building", note: null },
      { checks: [{ kind: "test", name: "tsc", passed: false, detail: "error TS2345" }] }
    );
    expect(o).toMatch(/FAILED tsc/);
    expect(o).toContain("error TS2345");
  });

  it("reports passed checks", () => {
    const o = summarizeTickOutcome(
      { status: "shipped", note: null },
      { checks: [{ kind: "test", name: "vitest", passed: true }] }
    );
    expect(o).toMatch(/passed vitest/);
  });

  it("surfaces the gate's hold reason when no check ran", () => {
    const o = summarizeTickOutcome({
      status: "building",
      note: "held: no objective check ran this cycle",
    });
    expect(o).toContain("held: no objective check ran");
  });

  it("flags a shipped status with no verifying check as NOT a real ship", () => {
    const o = summarizeTickOutcome({ status: "shipped", note: null });
    expect(o).toMatch(/NO verifying check|not a real ship/i);
  });

  it("describes a plan-only building tick", () => {
    const o = summarizeTickOutcome({ status: "building", note: null });
    expect(o).toMatch(/planned only/i);
  });
});

describe("schema + config", () => {
  it("constrains task enums in the json schema", () => {
    expect(DECISION_SCHEMA.properties.task.properties.category.enum).toContain("feature");
    expect(DECISION_SCHEMA.properties.task.properties.status.enum).toContain("shipped");
  });
  it("agentRuntimeConfigured reflects the env", () => {
    expect(typeof agentRuntimeConfigured()).toBe("boolean");
  });
});
