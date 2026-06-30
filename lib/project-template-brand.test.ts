import { describe, it, expect } from "vitest";
import { brandedLayoutJsx, brandedPageJsx, loopTokenUrl, loopOgImageUrl } from "./project-template-brand";

const BRAND = { key: "forge", name: "MEMEFORGE", ticker: "FORGE", description: "An AI meme factory.", tokenImageUrl: "https://x.com/logo.png" };

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
