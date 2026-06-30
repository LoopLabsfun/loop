import { describe, it, expect, vi } from "vitest";
import { issueAdminToken, ADMIN_COOKIE } from "./admin-session";

// isFounder grants access when the session wallet EITHER matches the target
// project's own creator_wallet OR is the LOOP platform super-admin (LOOP's own
// creator_wallet) — checked via a live lib/queries lookup, so it's mocked here.
// This is the exact gap a founder hit in prod: each launched project gets its
// own distinct creator_wallet, so without the super-admin branch the platform
// wallet could only ever administer "loop" itself.
const LOOP_FOUNDER = "7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9";
const FAME_FOUNDER = "DrUJpyCnAwJ7JTCjqNoxjyEaXMMcSVQLZ2bzGntt8xeT";
const RANDOM_WALLET = "RaNDoM11111111111111111111111111111111111";
const SECRET = "test-admin-session-secret";

vi.mock("./queries", () => ({
  getProject: vi.fn(async (key: string) =>
    key === "loop" ? { key: "loop", creatorWallet: LOOP_FOUNDER } : null
  ),
}));

function reqAs(wallet: string): Request {
  const token = issueAdminToken(wallet, { key: SECRET });
  return new Request("https://example.com/api/admin/x", {
    headers: { cookie: `${ADMIN_COOKIE}=${encodeURIComponent(token!)}` },
  });
}

describe("isFounder", () => {
  it("allows a project's own creator_wallet", async () => {
    const { isFounder } = await import("./admin-guard");
    process.env.ADMIN_SESSION_SECRET = SECRET;
    const ok = await isFounder(reqAs(FAME_FOUNDER), { creatorWallet: FAME_FOUNDER });
    expect(ok).toBe(true);
  });

  it("allows the LOOP platform super-admin on a DIFFERENT project's creator_wallet", async () => {
    const { isFounder } = await import("./admin-guard");
    process.env.ADMIN_SESSION_SECRET = SECRET;
    const ok = await isFounder(reqAs(LOOP_FOUNDER), { creatorWallet: FAME_FOUNDER });
    expect(ok).toBe(true);
  });

  it("denies a wallet that is neither the project's creator nor the super-admin", async () => {
    const { isFounder } = await import("./admin-guard");
    process.env.ADMIN_SESSION_SECRET = SECRET;
    const ok = await isFounder(reqAs(RANDOM_WALLET), { creatorWallet: FAME_FOUNDER });
    expect(ok).toBe(false);
  });

  it("denies a request with no session cookie", async () => {
    const { isFounder } = await import("./admin-guard");
    process.env.ADMIN_SESSION_SECRET = SECRET;
    const ok = await isFounder(new Request("https://example.com/api/admin/x"), {
      creatorWallet: FAME_FOUNDER,
    });
    expect(ok).toBe(false);
  });

  it("denies when the project has no creator_wallet set and the caller isn't the super-admin", async () => {
    const { isFounder } = await import("./admin-guard");
    process.env.ADMIN_SESSION_SECRET = SECRET;
    const ok = await isFounder(reqAs(RANDOM_WALLET), { creatorWallet: null });
    expect(ok).toBe(false);
  });
});
