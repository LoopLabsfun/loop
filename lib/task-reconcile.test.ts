import { describe, it, expect } from "vitest";
import { landedBuildingTitles } from "./task-reconcile";

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
