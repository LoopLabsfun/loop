import { describe, it, expect, afterEach, vi } from "vitest";
import { isEmailConfigured, agentFrom, sendAgentEmail } from "./email-send";
import type { Project } from "./types";

const base: Project = {
  key: "demo" as Project["key"],
  name: "Demo Co",
  ticker: "$DEMO",
  description: "A demo project.",
  official: false,
  launchpad: "Pump.fun",
  repo: "github.com/x/demo",
  cover: "neon",
  price: 0.0001,
  marketCap: "$30K",
  liquidity: "$4K",
  holders: "1",
  volume24h: "0 SOL",
  curve: 0.02,
  supply: "1B",
  treasurySol: 0,
  earnedSol: 0,
  burnPerDay: "0.10 SOL/day",
  runway: "booting",
};

const okJson = (body: object) =>
  ({ ok: true, json: async () => body, status: 200 }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

describe("isEmailConfigured", () => {
  it("reflects whether a provider key is set", () => {
    delete process.env.RESEND_API_KEY;
    expect(isEmailConfigured()).toBe(false);
    process.env.RESEND_API_KEY = "re_x";
    expect(isEmailConfigured()).toBe(true);
  });
});

describe("agentFrom", () => {
  it("is the project agent's own mailbox", () => {
    expect(agentFrom(base)).toBe("demo@agents.looplabs.fun");
  });
});

describe("sendAgentEmail", () => {
  it("no-ops (skipped) without a key and never calls fetch", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendAgentEmail(base, {
      to: "x@y.com",
      subject: "Hi",
      text: "hello",
    });

    expect(res).toEqual({ ok: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to Resend with bearer auth and the agent's from-address", async () => {
    process.env.RESEND_API_KEY = "re_x";
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: "email_1" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendAgentEmail(base, {
      to: "founders@earlyusers.io",
      subject: "Built something for Demo Co",
      text: "intro body",
    });

    expect(res).toEqual({ ok: true, id: "email_1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_x");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      from: "demo@agents.looplabs.fun",
      to: "founders@earlyusers.io",
      subject: "Built something for Demo Co",
      text: "intro body",
    });
  });

  it("honors a from override", async () => {
    process.env.RESEND_API_KEY = "re_x";
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: "email_2" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendAgentEmail(base, {
      to: "x@y.com",
      subject: "s",
      text: "t",
      from: "ops@looplabs.fun",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).from).toBe("ops@looplabs.fun");
  });

  it("surfaces a provider error (ok:false)", async () => {
    process.env.RESEND_API_KEY = "re_x";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ message: "domain not verified" }),
      } as Response)
    );

    const res = await sendAgentEmail(base, { to: "x@y.com", subject: "s", text: "t" });
    expect(res).toEqual({ ok: false, error: "domain not verified" });
  });

  it("catches network failures instead of throwing", async () => {
    process.env.RESEND_API_KEY = "re_x";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const res = await sendAgentEmail(base, { to: "x@y.com", subject: "s", text: "t" });
    expect(res).toEqual({ ok: false, error: "ECONNRESET" });
  });
});
