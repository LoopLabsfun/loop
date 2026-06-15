import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  coerceDecision,
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

  it("clamps lengths", () => {
    const d = coerceDecision({
      summary: "x".repeat(500),
      task: { title: "y".repeat(300), detail: "z".repeat(900), category: "ops", status: "todo" },
    });
    expect(d!.summary.length).toBeLessThanOrEqual(280);
    expect(d!.task.title.length).toBeLessThanOrEqual(120);
    expect(d!.task.detail.length).toBeLessThanOrEqual(500);
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
