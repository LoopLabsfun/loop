import { describe, it, expect } from "vitest";
import {
  slugFromAgentAddress,
  inboundRow,
  outboundRow,
  SUBJECT_MAX,
  PREVIEW_MAX,
} from "./email-inbound";

describe("slugFromAgentAddress", () => {
  it("extracts the slug from a bare agent address", () => {
    expect(slugFromAgentAddress("loop@agents.looplabs.fun")).toBe("loop");
  });
  it("unwraps a `Name <addr>` form and lowercases", () => {
    expect(slugFromAgentAddress('"LOOP Agent" <Loop@agents.looplabs.fun>')).toBe("loop");
  });
  it("normalizes to alphanumerics (matches agentSlug)", () => {
    expect(slugFromAgentAddress("gta-vi@agents.looplabs.fun")).toBe("gtavi");
  });
  it("rejects a non-agent domain", () => {
    expect(slugFromAgentAddress("loop@gmail.com")).toBeNull();
    expect(slugFromAgentAddress("loop@evil.agents.looplabs.fun")).toBeNull();
  });
  it("rejects malformed / empty input", () => {
    expect(slugFromAgentAddress("")).toBeNull();
    expect(slugFromAgentAddress(null)).toBeNull();
    expect(slugFromAgentAddress("not-an-email")).toBeNull();
    expect(slugFromAgentAddress("@agents.looplabs.fun")).toBeNull();
  });
});

describe("inboundRow", () => {
  it("builds a clean 'in' row for the resolved project", () => {
    const row = inboundRow("loop", {
      to: "loop@agents.looplabs.fun",
      from: '"Jane" <jane@acme.com>',
      subject: "Re: partnership",
      text: "Hey — let's talk.",
    });
    expect(row).toEqual({
      project_key: "loop",
      direction: "in",
      party: "jane@acme.com",
      subject: "Re: partnership",
      preview: "Hey — let's talk.",
    });
  });
  it("clamps subject + preview and collapses whitespace (no table bloat)", () => {
    const row = inboundRow("loop", {
      from: "x@y.com",
      subject: "S".repeat(500),
      text: "a\n\n   b\t".repeat(200),
    });
    expect(row.subject.length).toBe(SUBJECT_MAX);
    expect(row.preview.length).toBeLessThanOrEqual(PREVIEW_MAX);
    expect(row.preview).not.toMatch(/\s{2,}/);
  });
  it("supplies safe fallbacks for missing fields", () => {
    const row = inboundRow("loop", {});
    expect(row.party).toBe("unknown");
    expect(row.subject).toBe("(no subject)");
    expect(row.preview).toBe("");
  });
});

describe("outboundRow", () => {
  it("builds an 'out' row with the recipient as the party", () => {
    const row = outboundRow("loop", {
      to: "Founder@Acme.com",
      subject: "Intro from LOOP",
      text: "gm — quick intro.",
    });
    expect(row).toEqual({
      project_key: "loop",
      direction: "out",
      party: "founder@acme.com",
      subject: "Intro from LOOP",
      preview: "gm — quick intro.",
    });
  });
  it("clamps + collapses like the inbound row", () => {
    const row = outboundRow("loop", {
      to: "x@y.com",
      subject: "S".repeat(500),
      text: "a\n\n  b\t".repeat(200),
    });
    expect(row.subject.length).toBe(SUBJECT_MAX);
    expect(row.preview.length).toBeLessThanOrEqual(PREVIEW_MAX);
    expect(row.preview).not.toMatch(/\s{2,}/);
  });
});
