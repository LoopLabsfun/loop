import { describe, it, expect } from "vitest";
import {
  agentGitIdentity,
  DEFAULT_AGENT_GIT_EMAIL,
  DEFAULT_AGENT_GIT_NAME,
} from "./agent-git-identity";

describe("agentGitIdentity", () => {
  it("defaults to the Loop Labs org member, never a founder/personal identity", () => {
    const id = agentGitIdentity({});
    expect(id.name).toBe(DEFAULT_AGENT_GIT_NAME);
    expect(id.email).toBe(DEFAULT_AGENT_GIT_EMAIL);
    // Resolvable LoopLabsfun org member (so Vercel authorizes the deploy)…
    expect(id.email).toContain("looplabs-fun");
    expect(id.email).toMatch(/@users\.noreply\.github\.com$/);
    // …and explicitly NOT the founder's identity.
    expect(id.email).not.toContain("godisrupt");
    expect(id.name).not.toContain("godisrupt");
  });

  it("can be overridden per-project via env (future agents with their own identity)", () => {
    const id = agentGitIdentity({
      AGENT_GIT_AUTHOR_NAME: "acme-agent",
      AGENT_GIT_AUTHOR_EMAIL: "42+acme@users.noreply.github.com",
    });
    expect(id).toEqual({ name: "acme-agent", email: "42+acme@users.noreply.github.com" });
  });

  it("ignores blank/whitespace env and falls back to the default", () => {
    const id = agentGitIdentity({ AGENT_GIT_AUTHOR_NAME: "  ", AGENT_GIT_AUTHOR_EMAIL: "" });
    expect(id.name).toBe(DEFAULT_AGENT_GIT_NAME);
    expect(id.email).toBe(DEFAULT_AGENT_GIT_EMAIL);
  });
});
