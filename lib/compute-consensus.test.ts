import { describe, expect, it } from "vitest";
import { computeConsensus, type AssistRow } from "./compute-consensus";

function row(id: number, task: number, device: string, hash: string): AssistRow {
  return { id, project_key: "loop", task_id: task, device_id: device, device_name: device, result_hash: hash };
}

describe("computeConsensus", () => {
  it("unanimous: all agree, no dissent, trust 1", () => {
    const r = computeConsensus([row(1, 10, "a", "H"), row(2, 10, "b", "H")]);
    expect(r.tasksVerified).toBe(1);
    expect(r.dissentCount).toBe(0);
    expect(r.verdicts.every((v) => v.consensusOk)).toBe(true);
    expect(r.trust.every((t) => t.trust === 1)).toBe(true);
  });

  it("flags the dissenter and lowers its trust", () => {
    const r = computeConsensus([
      row(1, 10, "a", "H"), row(2, 10, "b", "H"), row(3, 10, "evil", "X"),
      row(4, 11, "a", "G"), row(5, 11, "evil", "G"),
    ]);
    expect(r.dissentCount).toBe(1);
    const evilVerdict = r.verdicts.find((v) => v.id === 3)!;
    expect(evilVerdict.consensusOk).toBe(false);
    const evil = r.trust.find((t) => t.deviceId === "evil")!;
    expect(evil.redundantAssists).toBe(2);
    expect(evil.agreed).toBe(1);
    expect(evil.dissented).toBe(1);
    expect(evil.trust).toBe(0.5);
    // honest device stays at trust 1
    expect(r.trust.find((t) => t.deviceId === "a")!.trust).toBe(1);
  });

  it("solo tasks are not verified", () => {
    const r = computeConsensus([row(1, 10, "a", "H"), row(2, 11, "b", "Z")]);
    expect(r.tasksVerified).toBe(0);
    expect(r.verdicts).toHaveLength(0);
  });

  it("empty input is safe", () => {
    const r = computeConsensus([]);
    expect(r).toEqual({ trust: [], verdicts: [], tasksVerified: 0, dissentCount: 0 });
  });
});
