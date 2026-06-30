import { describe, it, expect } from "vitest";
import { landedBuildingTitles, stalledBuildingTitles } from "./task-reconcile";

describe("landedBuildingTitles", () => {
  const commits = [
    { msg: "fix(agent): Add typed getExternalLink(key) lookup helper to canonical links registry" },
    { msg: "feat(agent): Add over-budget flag to budgetStatus clamped helper" },
    { msg: "chore: unrelated maintenance" },
  ];

  it("flags a building task whose title landed in a commit", () => {
    const tasks = [
      { title: "Add typed getExternalLink(key) lookup helper to canonical links registry", status: "building" },
      { title: "Add over-budget flag to budgetStatus clamped helper", status: "building" },
    ];
    expect(landedBuildingTitles(tasks, commits).sort()).toEqual(
      [
        "Add over-budget flag to budgetStatus clamped helper",
        "Add typed getExternalLink(key) lookup helper to canonical links registry",
      ].sort()
    );
  });

  it("ignores tasks that are not 'building' (already shipped/blocked/todo)", () => {
    const tasks = [
      { title: "Add typed getExternalLink(key) lookup helper to canonical links registry", status: "shipped" },
      { title: "Add over-budget flag to budgetStatus clamped helper", status: "blocked" },
    ];
    expect(landedBuildingTitles(tasks, commits)).toEqual([]);
  });

  it("ignores a building task with no matching commit", () => {
    const tasks = [{ title: "Build a brand-new dashboard nobody committed yet", status: "building" }];
    expect(landedBuildingTitles(tasks, commits)).toEqual([]);
  });

  it("is case- and whitespace-insensitive", () => {
    const tasks = [
      { title: "  add OVER-budget   flag to budgetStatus clamped helper ", status: "building" },
    ];
    expect(landedBuildingTitles(tasks, commits)).toEqual([
      "  add OVER-budget   flag to budgetStatus clamped helper ",
    ]);
  });

  it("skips trivially short titles to avoid false matches", () => {
    const tasks = [{ title: "fix", status: "building" }];
    expect(landedBuildingTitles([...tasks], [{ msg: "fix(agent): fix something" }])).toEqual([]);
  });

  it("dedupes when two building rows share a title", () => {
    const tasks = [
      { title: "Add over-budget flag to budgetStatus clamped helper", status: "building" },
      { title: "Add over-budget flag to budgetStatus clamped helper", status: "building" },
    ];
    expect(landedBuildingTitles(tasks, commits)).toEqual([
      "Add over-budget flag to budgetStatus clamped helper",
    ]);
  });
});

describe("stalledBuildingTitles", () => {
  const now = 1_000_000_000_000;
  const maxBuildMs = 90 * 60_000; // 90 min
  const fresh = now - 5 * 60_000; // 5 min ago — still plausibly running
  const old = now - 5 * 60 * 60_000; // 5h ago — finish callback was missed

  it("flags only building tasks older than the threshold", () => {
    const tasks = [
      { title: "Stalled landing-page hero that never shipped", status: "building", updatedAtMs: old },
      { title: "Still-running fresh build in flight right now", status: "building", updatedAtMs: fresh },
    ];
    expect(stalledBuildingTitles(tasks, now, maxBuildMs)).toEqual([
      "Stalled landing-page hero that never shipped",
    ]);
  });

  it("excludes a task that just reconciled to shipped (in landedTitles)", () => {
    const tasks = [
      { title: "Build the Loop landing page hero with CTAs", status: "building", updatedAtMs: old },
    ];
    // Even though it's old, it landed (reworded) — don't reap it.
    expect(
      stalledBuildingTitles(tasks, now, maxBuildMs, ["Build the Loop landing page hero with CTAs"])
    ).toEqual([]);
  });

  it("ignores non-building and non-finite timestamps", () => {
    const tasks = [
      { title: "Already shipped, just old", status: "shipped", updatedAtMs: old },
      { title: "Building but bad timestamp", status: "building", updatedAtMs: NaN },
    ];
    expect(stalledBuildingTitles(tasks, now, maxBuildMs)).toEqual([]);
  });

  it("reaps exactly at the threshold boundary", () => {
    const tasks = [
      { title: "Right at the stale boundary build", status: "building", updatedAtMs: now - maxBuildMs },
    ];
    expect(stalledBuildingTitles(tasks, now, maxBuildMs)).toEqual([
      "Right at the stale boundary build",
    ]);
  });
});
