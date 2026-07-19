import { describe, it, expect } from "vitest";
import { brandedLayoutJsx, brandedPageJsx, loopTokenUrl, loopOgImageUrl, truncateAtWord } from "./project-template-brand";

const BRAND = { key: "forge", name: "MEMEFORGE", ticker: "FORGE", description: "An AI meme factory.", tokenImageUrl: "https://x.com/logo.png" };

describe("truncateAtWord", () => {
  it("returns short text untouched, no ellipsis", () => {
    expect(truncateAtWord("An AI meme factory.", 300)).toBe("An AI meme factory.");
  });

  it("never cuts mid-word and marks the drop with an ellipsis", () => {
    const out = truncateAtWord("outgrow the U.S. National Debt forever", 33);
    expect(out).toBe("outgrow the U.S. National Debt…");
  });

  it("strips a dangling dash/comma left at the boundary", () => {
    const out = truncateAtWord("marketing and outreach — all funded by its treasury", 27);
    expect(out).toBe("marketing and outreach…");
  });

  it("never emits a period glued to the ellipsis", () => {
    const out = truncateAtWord("outgrow the National Debt. Governments print money.", 31);
    expect(out).toBe("outgrow the National Debt…");
  });
});

describe("loopTokenUrl / loopOgImageUrl", () => {
  it("point at the project's own token page + the shared dynamic OG image", () => {
    expect(loopTokenUrl("forge")).toBe("https://looplabs.fun/token?p=forge");
    expect(loopOgImageUrl("forge")).toBe("https://looplabs.fun/token-og?p=forge");
  });
});

describe("brandedLayoutJsx", () => {
  it("carries the project's identity into metadata + OG/twitter images", () => {
    const src = brandedLayoutJsx(BRAND);
    expect(src).toContain("MEMEFORGE (FORGE)");
    expect(src).toContain("An AI meme factory.");
    expect(src).toContain("https://looplabs.fun/token-og?p=forge");
    expect(src).toContain("export default function RootLayout");
  });
});

describe("brandedPageJsx", () => {
  it("renders the name, ticker, description, logo, and a link back to Loop", () => {
    const src = brandedPageJsx(BRAND);
    expect(src).toContain("MEMEFORGE");
    expect(src).toContain("$FORGE");
    expect(src).toContain("An AI meme factory.");
    expect(src).toContain("https://x.com/logo.png");
    expect(src).toContain("https://looplabs.fun/token?p=forge");
    expect(src).toContain("export default function Page");
  });

  it("omits the logo block when no token image was uploaded", () => {
    const src = brandedPageJsx({ ...BRAND, tokenImageUrl: null });
    expect(src).not.toContain("<img");
  });
});
