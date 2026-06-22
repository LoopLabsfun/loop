import { describe, it, expect } from "vitest";
import { EXTERNAL_LINKS } from "./links";

describe("EXTERNAL_LINKS registry", () => {
  it("is non-empty", () => {
    expect(EXTERNAL_LINKS.length).toBeGreaterThan(0);
  });

  it("every href is a valid https URL", () => {
    for (const link of EXTERNAL_LINKS) {
      const url = new URL(link.href);
      expect(url.protocol).toBe("https:");
    }
  });

  it("has unique keys", () => {
    const keys = EXTERNAL_LINKS.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has unique hrefs", () => {
    const hrefs = EXTERNAL_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("every link has a label and an aria-label", () => {
    for (const link of EXTERNAL_LINKS) {
      expect(link.label.trim().length).toBeGreaterThan(0);
      expect(link.ariaLabel.trim().length).toBeGreaterThan(0);
    }
  });
});
