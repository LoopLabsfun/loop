import { describe, it, expect } from "vitest";
import {
  EXTERNAL_LINKS,
  getExternalLink,
  type ExternalLinkKey,
} from "./links";

describe("EXTERNAL_LINKS", () => {
  it("is a non-empty list", () => {
    expect(EXTERNAL_LINKS.length).toBeGreaterThan(0);
  });

  it("has unique keys", () => {
    const keys = EXTERNAL_LINKS.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has unique hrefs", () => {
    const hrefs = EXTERNAL_LINKS.map((l) => l.href);
    // Two entries pointing at the same URL is almost always a copy-paste bug.
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("every href is a fully-qualified https URL", () => {
    for (const link of EXTERNAL_LINKS) {
      expect(link.href.startsWith("https://")).toBe(true);
      // Throws on a malformed URL — guards against typos / missing scheme.
      const url = new URL(link.href);
      expect(url.protocol).toBe("https:");
      expect(url.hostname.length).toBeGreaterThan(0);
    }
  });

  it("every link has a non-empty visible label without the glyph", () => {
    for (const link of EXTERNAL_LINKS) {
      expect(link.label.trim().length).toBeGreaterThan(0);
      expect(link.label).not.toContain("↗");
    }
  });

  it("every link has an accessible label noting it opens in a new tab", () => {
    for (const link of EXTERNAL_LINKS) {
      expect(link.ariaLabel.trim().length).toBeGreaterThan(0);
      expect(link.ariaLabel.toLowerCase()).toContain("new tab");
    }
  });

  it("every ariaLabel references its visible label", () => {
    // Keeps the screen-reader text in sync with the rendered label so an
    // entry can't drift to describing the wrong destination.
    for (const link of EXTERNAL_LINKS) {
      expect(link.ariaLabel).toContain(link.label);
    }
  });

  it("includes the GitHub repo link", () => {
    const gh = EXTERNAL_LINKS.find((l) => l.key === "github");
    expect(gh).toBeDefined();
    expect(gh!.href).toContain("github.com");
  });
});

describe("ExternalLinkKey", () => {
  it("derives a union that every registry key is assignable to", () => {
    // Compile-time guarantee surfaced at runtime: assigning each entry's key
    // into an ExternalLinkKey variable type-checks only because the registry
    // preserves its literal key types (`as const satisfies`).
    for (const link of EXTERNAL_LINKS) {
      const key: ExternalLinkKey = link.key;
      expect(getExternalLink(key)).toBe(link);
    }
  });

  it("resolves known literal keys through getExternalLink", () => {
    const knownKeys: ExternalLinkKey[] = ["github", "x", "telegram"];
    for (const key of knownKeys) {
      expect(getExternalLink(key)?.key).toBe(key);
    }
  });
});

describe("getExternalLink", () => {
  it("resolves every registered key to its exact entry", () => {
    for (const link of EXTERNAL_LINKS) {
      expect(getExternalLink(link.key)).toBe(link);
    }
  });

  it("returns undefined for an unknown key", () => {
    expect(getExternalLink("does-not-exist")).toBeUndefined();
    expect(getExternalLink("")).toBeUndefined();
  });
});
