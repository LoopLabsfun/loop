import { describe, it, expect } from "vitest";
import { epicsEnabled, validateEpicPlan } from "./agent-epics";

describe("epicsEnabled", () => {
  it("is opt-in via AGENT_EPICS=1", () => {
    expect(epicsEnabled({})).toBe(false);
    expect(epicsEnabled({ AGENT_EPICS: "1" })).toBe(true);
    expect(epicsEnabled({ AGENT_EPICS: "0" })).toBe(false);
  });
});

describe("validateEpicPlan", () => {
  const sub = (title: string, over: Record<string, unknown> = {}) => ({
    title,
    detail: `do ${title}`,
    category: "feature",
    ...over,
  });

  it("accepts a clean 2..6-subtask plan", () => {
    const plan = validateEpicPlan({
      title: "Ship the analytics dashboard",
      subtasks: [sub("Add the data endpoint"), sub("Render the charts panel")],
    });
    expect(plan?.title).toBe("Ship the analytics dashboard");
    expect(plan?.subtasks).toHaveLength(2);
  });

  it("coerces an invalid category to feature and clamps lengths", () => {
    const plan = validateEpicPlan({
      title: "T".repeat(300),
      subtasks: [
        sub("A", { category: "yolo", detail: "d".repeat(900) }),
        sub("B"),
      ],
    });
    expect(plan?.title.length).toBe(120);
    expect(plan?.subtasks[0].category).toBe("feature");
    expect(plan?.subtasks[0].detail.length).toBe(500);
  });

  it("dedupes subtask titles (and never repeats the parent title)", () => {
    const plan = validateEpicPlan({
      title: "Big feature",
      subtasks: [sub("Step one"), sub("step ONE"), sub("Big feature"), sub("Step two")],
    });
    expect(plan?.subtasks.map((s) => s.title)).toEqual(["Step one", "Step two"]);
  });

  it("caps at 6 subtasks", () => {
    const plan = validateEpicPlan({
      title: "Huge",
      subtasks: Array.from({ length: 10 }, (_, i) => sub(`Step ${i}`)),
    });
    expect(plan?.subtasks).toHaveLength(6);
  });

  it("rejects plans without a title or with fewer than 2 usable subtasks", () => {
    expect(validateEpicPlan(null)).toBeNull();
    expect(validateEpicPlan({ title: "", subtasks: [sub("A"), sub("B")] })).toBeNull();
    expect(validateEpicPlan({ title: "X", subtasks: [sub("Only one")] })).toBeNull();
    expect(validateEpicPlan({ title: "X", subtasks: "nope" })).toBeNull();
  });
});
