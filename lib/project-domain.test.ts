import { describe, it, expect } from "vitest";
import { normalizeDomain, projectVercelProject } from "./project-domain";

describe("normalizeDomain", () => {
  it("strips protocol, path, port, and trailing dot", () => {
    expect(normalizeDomain("https://Foo.com/path?x=1")).toBe("foo.com");
    expect(normalizeDomain("http://foo.com:443")).toBe("foo.com");
    expect(normalizeDomain("foo.com.")).toBe("foo.com");
    expect(normalizeDomain("  WWW.Foo.COM  ")).toBe("www.foo.com");
  });

  it("accepts apex and subdomains", () => {
    expect(normalizeDomain("foo.com")).toBe("foo.com");
    expect(normalizeDomain("app.foo.com")).toBe("app.foo.com");
    expect(normalizeDomain("a.b.co.uk")).toBe("a.b.co.uk");
  });

  it("rejects junk, bare hosts, and vercel.app", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull(); // no dot
    expect(normalizeDomain("foo")).toBeNull();
    expect(normalizeDomain("foo..com")).toBeNull();
    expect(normalizeDomain("-foo.com")).toBeNull();
    expect(normalizeDomain("foo-.com")).toBeNull();
    expect(normalizeDomain("foo .com")).toBeNull(); // space → invalid char
    expect(normalizeDomain("build-loop-labs-fun.vercel.app")).toBeNull();
    expect(normalizeDomain(42 as unknown)).toBeNull();
  });

  it("rejects an over-long host", () => {
    expect(normalizeDomain("a".repeat(64) + ".com")).toBeNull(); // label > 63
    expect(normalizeDomain("a.b")).toBeNull(); // too short overall (<4)? "a.b" is 3
  });
});

describe("projectVercelProject", () => {
  it("mirrors the provisioning slug (key → vercel project name)", () => {
    expect(projectVercelProject("build")).toBe("build");
    expect(projectVercelProject("My Cool Project!")).toBe("my-cool-project");
    expect(projectVercelProject("loop")).toBe("loop");
  });
});
