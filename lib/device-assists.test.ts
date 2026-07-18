import { describe, expect, it } from "vitest";
import { formatDeviceAssistsForPrompt, type DeviceAssist } from "./device-assists";

describe("formatDeviceAssistsForPrompt", () => {
  it("renders empty state", () => {
    expect(formatDeviceAssistsForPrompt([])).toMatch(/no device assists/i);
  });

  it("includes task id and brief", () => {
    const a: DeviceAssist = {
      id: "1",
      projectKey: "loop",
      taskId: 69,
      jobId: "abc",
      title: "Harden agent loop",
      deviceId: "dev1",
      deviceName: "Mac M1",
      complexity: "M",
      keywords: ["agent", "treasury"],
      prepBrief: "## Brief\nDo the thing",
      resultHash: "deadbeef",
      createdAt: "2026-07-18T00:00:00Z",
      source: "device_assists",
    };
    const s = formatDeviceAssistsForPrompt([a]);
    expect(s).toMatch(/task #69/);
    expect(s).toMatch(/Harden agent loop/);
    expect(s).toMatch(/Do the thing/);
    expect(s).toMatch(/Mac M1/);
  });
});
