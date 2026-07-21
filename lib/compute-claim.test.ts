import { describe, it, expect, afterEach } from "vitest";
import { buildClaimTx, confirmClaim, quoteClaim } from "./compute-claim";

// The claim path is I/O-heavy (Supabase + chain), but its GATES must hold
// without any backend: disarmed → no tx is ever built, no ledger is touched.
// (The deeper invariants — ledger-bounded amounts, the pending lock, memo
// proof — are enforced server-side against real state; these tests pin the
// dormant-by-default posture that lets the code ship ahead of arming.)

afterEach(() => {
  delete process.env.COMPUTE_REWARDS_PAY;
});

describe("claim gates (disarmed / unconfigured)", () => {
  it("quoteClaim reports closed when COMPUTE_REWARDS_PAY is unset", async () => {
    const q = await quoteClaim("web-test");
    expect(q.ok).toBe(false);
    expect(q.claimableLoop).toBe(0);
    expect(q.note).toContain("not open");
  });

  it("buildClaimTx refuses to build while disarmed", async () => {
    const b = await buildClaimTx("web-test");
    expect(b.ok).toBe(false);
    expect(b.txBase64).toBeUndefined();
    expect(b.note).toContain("COMPUTE_REWARDS_PAY");
  });

  it("armed but without a backend, build fails safe (no service-role client)", async () => {
    process.env.COMPUTE_REWARDS_PAY = "1";
    const b = await buildClaimTx("web-test");
    expect(b.ok).toBe(false);
    expect(b.txBase64).toBeUndefined();
  });

  it("confirmClaim never credits without a backend row", async () => {
    process.env.COMPUTE_REWARDS_PAY = "1";
    const c = await confirmClaim("web-test", "5".repeat(87));
    expect(c.ok).toBe(false);
    expect(c.claimedLoop).toBeUndefined();
  });
});
