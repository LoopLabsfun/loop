import { describe, it, expect } from "vitest";
import { EXTERNAL_LINKS, getExternalLink } from "./links";

describe("EXTERNAL_LINKS", () => {
  it("is a non-empty list", () => {
    expect(EXTERNAL_LINKS.length).toBeGreaterThan(0);
  });

  it("has unique keys", () => {
    const keys = EXTERNAL_LINKS.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
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

  it("includes the GitHub repo link", () => {
    const gh = EXTERNAL_LINKS.find((l) => l.key === "github");
    expect(gh).toBeDefined();
    expect(gh!.href).toContain("github.com");
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
