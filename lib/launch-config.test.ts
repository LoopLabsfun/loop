import { describe, it, expect, afterEach } from "vitest";
import { launchesOpen, LAUNCHES_CLOSED_MESSAGE } from "./launch-config";

const KEY = "NEXT_PUBLIC_LAUNCHES_OPEN";

describe("launchesOpen", () => {
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("is CLOSED by default (Phase A / LOOP-only)", () => {
    delete process.env[KEY];
    expect(launchesOpen()).toBe(false);
  });

  it("stays closed for any value other than the exact string 'true'", () => {
    for (const v of ["false", "1", "yes", "TRUE", "", " true "]) {
      process.env[KEY] = v;
      expect(launchesOpen()).toBe(false);
    }
  });

  it("opens only when explicitly set to 'true'", () => {
    process.env[KEY] = "true";
    expect(launchesOpen()).toBe(true);
  });

  it("has a non-empty closed message for the UI/action", () => {
    expect(LAUNCHES_CLOSED_MESSAGE.length).toBeGreaterThan(0);
  });
});
