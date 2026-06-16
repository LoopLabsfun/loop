import { describe, it, expect } from "vitest";
import {
  slugFromAgentAddress,
  inboundRow,
  SUBJECT_MAX,
  PREVIEW_MAX,
} from "./email-inbound";

describe("slugFromAgentAddress", () => {
  it("extracts the slug from a bare agent address", () => {
    expect(slugFromAgentAddress("loop@agents.loop.fun")).toBe("loop");
  });
  it("unwraps a `Name <addr>` form and lowercases", () => {
    expect(slugFromAgentAddress('"LOOP Agent" <Loop@agents.loop.fun>')).toBe("loop");
  });
  it("normalizes to alphanumerics (matches agentSlug)", () => {
    expect(slugFromAgentAddress("gta-vi@agents.loop.fun")).toBe("gtavi");
  });
  it("rejects a non-agent domain", () => {
    expect(slugFromAgentAddress("loop@gmail.com")).toBeNull();
    expect(slugFromAgentAddress("loop@evil.agents.loop.fun")).toBeNull();
  });
  it("rejects malformed / empty input", () => {
    expect(slugFromAgentAddress("")).toBeNull();
    expect(slugFromAgentAddress(null)).toBeNull();
    expect(slugFromAgentAddress("not-an-email")).toBeNull();
    expect(slugFromAgentAddress("@agents.loop.fun")).toBeNull();
  });
});

describe("inboundRow", () => {
  it("builds a clean 'in' row for the resolved project", () => {
    const row = inboundRow("loop", {
      to: "loop@agents.loop.fun",
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
