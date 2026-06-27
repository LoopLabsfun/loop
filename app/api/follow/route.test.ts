import { describe, it, expect, vi, beforeEach } from "vitest";

// Two real base58 Solana addresses (44 chars).
const A = "H8UMZSW2nZQm59G56UGmKAKVcgf5rcgEdFbVvcA9TSvC";
const B = "8p8VtLJ5PkUNYR3ih3ykw9797572vKeFBaKYgAZr3Q5t";

// The cookie is always present; verifyUserToken (mocked) decides who it's for.
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "tok" }) }) }));

// Keep the REAL isStaleSession + USER_COOKIE; only control verifyUserToken.
vi.mock("@/lib/user-session", async (orig) => {
  const actual = await orig<typeof import("@/lib/user-session")>();
  return { ...actual, verifyUserToken: vi.fn() };
});

// No DB in unit tests — the social writes are stubbed.
vi.mock("@/lib/social", () => ({
  follow: vi.fn(async () => ({ ok: true })),
  unfollow: vi.fn(async () => ({ ok: true })),
  isFollowing: vi.fn(async () => false),
}));

import { POST } from "@/app/api/follow/route";
import { verifyUserToken } from "@/lib/user-session";
import { follow } from "@/lib/social";

const mockVerify = vi.mocked(verifyUserToken);
const session = (wallet: string | null) => mockVerify.mockReturnValue(wallet ? { wallet, exp: Date.now() + 1e6 } : null);

function req(body: unknown) {
  return new Request("http://x/api/follow", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `t-${Math.random()}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/follow — session & actor binding", () => {
  it("401 when there is no session", async () => {
    session(null);
    expect((await POST(req({ target: B, actor: A }))).status).toBe(401);
  });

  it("401 (stale) when the connected wallet differs from the cookie's", async () => {
    session(A); // cookie is for A
    const res = await POST(req({ target: B, actor: B })); // client claims it's connected as B
    expect(res.status).toBe(401);
    expect((await res.json()).stale).toBe(true);
    expect(follow).not.toHaveBeenCalled();
  });

  it("400 on an invalid target", async () => {
    session(A);
    expect((await POST(req({ target: "not-a-wallet", actor: A }))).status).toBe(400);
  });

  it("follows as the cookie wallet on a valid request", async () => {
    session(A);
    const res = await POST(req({ target: B, action: "follow", actor: A }));
    expect(res.status).toBe(200);
    expect(follow).toHaveBeenCalledWith(A, B);
  });

  it("propagates a follow() rejection as 400 (e.g. cannot follow yourself)", async () => {
    session(A);
    vi.mocked(follow).mockResolvedValueOnce({ ok: false, error: "cannot follow yourself" });
    expect((await POST(req({ target: A, action: "follow", actor: A }))).status).toBe(400);
  });
});
