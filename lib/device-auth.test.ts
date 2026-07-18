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
