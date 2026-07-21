import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SECRET = "test-ingest-secret";

// device-auth reads env at call time via process.env, so set it before import.
beforeEach(() => {
  process.env.DEVICE_TOKEN_SECRET = SECRET;
  delete process.env.COMPUTE_INGEST_SECRET;
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  delete process.env.DEVICE_TOKEN_SECRET;
});

async function load() {
  return import("./device-auth");
}

describe("device tokens", () => {
  it("round-trips: verify recovers the issued deviceId", async () => {
    const { issueDeviceToken, verifyDeviceToken } = await load();
    const token = issueDeviceToken("mac-abc123");
    expect(token).toMatch(/^dt1\.mac-abc123\.[0-9a-f]{64}$/);
    expect(verifyDeviceToken(token)).toBe("mac-abc123");
  });

  it("rejects a tampered deviceId (signature no longer matches)", async () => {
    const { issueDeviceToken, verifyDeviceToken } = await load();
    const token = issueDeviceToken("mac-abc123")!;
    const forged = token.replace("mac-abc123", "mac-evil999");
    expect(verifyDeviceToken(forged)).toBeNull();
  });

  it("rejects a tampered mac", async () => {
    const { issueDeviceToken, verifyDeviceToken } = await load();
    const token = issueDeviceToken("d1")!;
    expect(verifyDeviceToken(token.slice(0, -1) + "0")).toBeNull();
  });

  it("rejects malformed / empty tokens without throwing", async () => {
    const { verifyDeviceToken } = await load();
    for (const t of [null, undefined, "", "nope", "dt1.only-two", "dt2.d1.abcd"]) {
      expect(verifyDeviceToken(t as string)).toBeNull();
    }
  });

  it("refuses to issue a deviceId containing a dot", async () => {
    const { issueDeviceToken } = await load();
    expect(issueDeviceToken("a.b")).toBeNull();
  });
});

describe("v2 tokens (linked Hood payout address)", () => {
  const HOOD_ADDR = "0x00000000000000000000000000000000000000ad";

  it("round-trips: verifyDeviceTokenFull recovers deviceId + hoodAddress", async () => {
    const { issueDeviceTokenWithHood, verifyDeviceTokenFull } = await load();
    const token = issueDeviceTokenWithHood("web-abc123", HOOD_ADDR);
    expect(token).toMatch(/^dt2\.web-abc123\.0x0+ad\.[0-9a-f]{64}$/);
    expect(verifyDeviceTokenFull(token)).toEqual({ deviceId: "web-abc123", hoodAddress: HOOD_ADDR });
  });

  it("verifyDeviceToken (legacy shape) still recovers just the deviceId from a v2 token", async () => {
    const { issueDeviceTokenWithHood, verifyDeviceToken } = await load();
    const token = issueDeviceTokenWithHood("web-abc123", HOOD_ADDR);
    expect(verifyDeviceToken(token)).toBe("web-abc123");
  });

  it("a v1 token has no hoodAddress", async () => {
    const { issueDeviceToken, verifyDeviceTokenFull } = await load();
    const token = issueDeviceToken("web-abc123");
    expect(verifyDeviceTokenFull(token)).toEqual({ deviceId: "web-abc123", hoodAddress: null });
  });

  it("rejects a tampered hoodAddress (signature no longer matches)", async () => {
    const { issueDeviceTokenWithHood, verifyDeviceTokenFull } = await load();
    const token = issueDeviceTokenWithHood("web-abc123", HOOD_ADDR)!;
    const forged = token.replace(HOOD_ADDR, "0x00000000000000000000000000000000000000ff");
    expect(verifyDeviceTokenFull(forged)).toBeNull();
  });

  it("refuses to issue with a malformed EVM address", async () => {
    const { issueDeviceTokenWithHood } = await load();
    expect(issueDeviceTokenWithHood("web-abc123", "not-an-address")).toBeNull();
  });
});

describe("authorizeCompute", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://x/api", { method: "POST", headers });

  it("accepts the shared ingest secret", async () => {
    process.env.COMPUTE_INGEST_SECRET = SECRET;
    const { authorizeCompute } = await load();
    const a = authorizeCompute(req({ "x-compute-secret": SECRET }));
    expect(a).toMatchObject({ ok: true, kind: "secret", deviceId: null });
  });

  it("accepts a device token and returns its deviceId", async () => {
    const { issueDeviceToken, authorizeCompute } = await load();
    const token = issueDeviceToken("dev-77")!;
    const a = authorizeCompute(req({ "x-device-token": token }));
    expect(a).toMatchObject({ ok: true, kind: "device-token", deviceId: "dev-77" });
  });

  it("rejects a request with neither", async () => {
    const { authorizeCompute } = await load();
    expect(authorizeCompute(req({})).ok).toBe(false);
  });
});
