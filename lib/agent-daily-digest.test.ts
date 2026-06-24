import { describe, it, expect } from "vitest";
import {
  composeDailyDigest,
  digestDayKey,
  digestEnabled,
  founderDigestEmail,
} from "./agent-daily-digest";
import type { DigestInput } from "./agent-daily-digest";
import type { Project } from "./types";

const project = {
  key: "loop",
  ticker: "$LOOP",
  treasurySol: 1.5,
  repo: "https://github.com/LoopLabsfun/loop",
} as Pick<Project, "key" | "ticker" | "treasurySol" | "repo">;

// 2026-06-24T15:00:00Z
const NOW = Date.parse("2026-06-24T15:00:00.000Z");
const todayMs = Date.parse("2026-06-24T09:00:00.000Z");
const yesterdayMs = Date.parse("2026-06-23T23:00:00.000Z");

const base: DigestInput = {
  summaries: [{ id: "s1", day: "Today", shipped: ["Shipped the OG card"], note: "" }],
  tasks: [
    { id: "t1", title: "OG card", detail: "", category: "feature", status: "shipped", at: "" },
    { id: "t2", title: "Email digest", detail: "", category: "feature", status: "building", at: "" },
  ],
  directives: [
    { id: "d1", kind: "proposal", at: "", text: "open a discord", status: "open" },
    { id: "d2", kind: "proposal", at: "", text: "old idea", status: "adopted", exec: "done" },
  ],
  screenedDirectives: 2,
  inbox: [
    { id: "m1", direction: "in", party: "ann@x.com", subject: "Gm", preview: "hi", at: "", answered: false },
    { id: "m2", direction: "in", party: "bob@y.com", subject: "Done", preview: "x", at: "", answered: true },
  ],
  actions: [],
  commits: [
    { msg: "feat(og): share card\n\nbody", date: todayMs },
    { msg: "feat(og): share card", date: todayMs }, // duplicate subject → deduped
    { msg: "chore: yesterday work", date: yesterdayMs }, // not today → excluded
  ],
};

describe("composeDailyDigest", () => {
  it("includes shipped, today's commits, open asks and unanswered mail", () => {
    const { subject, text } = composeDailyDigest(project, base, NOW);
    expect(subject).toContain("$LOOP");
    expect(subject).toContain("2026-06-24");

    expect(text).toContain("Shipped the OG card");
    expect(text).toContain("Treasury: 1.5 SOL");

    // commit today (deduped to one), yesterday's excluded
    expect(text).toContain("feat(og): share card");
    expect(text).not.toContain("yesterday work");
    expect(text).toMatch(/COMMITS PUSHED TODAY \(1\)/);

    // in-progress task surfaced
    expect(text).toContain("Email digest");

    // open ask shown; a 'done' adopted proposal is filtered out
    expect(text).toContain("open a discord");
    expect(text).not.toContain("old idea");
    expect(text).toContain("auto-screened out");

    // only the unanswered inbound is listed
    expect(text).toContain("ann@x.com");
    expect(text).not.toContain("bob@y.com");
  });

  it("reports a quiet day honestly rather than skipping", () => {
    const { text } = composeDailyDigest(
      project,
      { summaries: [], tasks: [], directives: [], screenedDirectives: 0, inbox: [], actions: [], commits: [] },
      NOW
    );
    expect(text).toContain("nothing shipped today");
    expect(text).toContain("no commits today");
    expect(text).toContain("no open asks");
    expect(text).not.toContain("auto-screened out");
  });
});

describe("digest config", () => {
  it("is opt-out (on unless AGENT_DAILY_DIGEST=0)", () => {
    expect(digestEnabled({})).toBe(true);
    expect(digestEnabled({ AGENT_DAILY_DIGEST: "1" })).toBe(true);
    expect(digestEnabled({ AGENT_DAILY_DIGEST: "0" })).toBe(false);
  });

  it("defaults the founder address to hello@looplabs.fun", () => {
    expect(founderDigestEmail()).toBe("hello@looplabs.fun");
  });

  it("keys the day by UTC calendar date", () => {
    expect(digestDayKey(Date.parse("2026-06-24T23:30:00.000Z"))).toBe("2026-06-24");
  });
});
