import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  coerceDecision,
  routeAction,
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
});

describe("buildUserPrompt", () => {
  it("handles the empty cold-start case", () => {
    const s = buildUserPrompt([], []);
    expect(s).toContain("no tasks yet");
    expect(s).toContain("no founder/holder directives");
  });
  it("lists tasks and directives", () => {
    const tasks = [
      { id: "1", title: "Ship auth", detail: "", category: "feature", status: "building", at: "" },
    ] as AgentTask[];
    const directives = [
      { id: "d1", kind: "directive", at: "", text: "Focus on mobile", by: "you (founder)" },
    ] as FeedItem[];
    const s = buildUserPrompt(tasks, directives);
    expect(s).toContain("Ship auth");
    expect(s).toContain("Focus on mobile");
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
    expect(coerceDecision(good).action).toBeUndefined();
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

describe("schema + config", () => {
  it("constrains task enums in the json schema", () => {
    expect(DECISION_SCHEMA.properties.task.properties.category.enum).toContain("feature");
    expect(DECISION_SCHEMA.properties.task.properties.status.enum).toContain("shipped");
  });
  it("agentRuntimeConfigured reflects the env", () => {
    expect(typeof agentRuntimeConfigured()).toBe("boolean");
  });
});
