import { describe, it, expect, vi, beforeEach } from "vitest";

const A = "H8UMZSW2nZQm59G56UGmKAKVcgf5rcgEdFbVvcA9TSvC";
const B = "8p8VtLJ5PkUNYR3ih3ykw9797572vKeFBaKYgAZr3Q5t";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "tok" }) }) }));

vi.mock("@/lib/user-session", async (orig) => {
  const actual = await orig<typeof import("@/lib/user-session")>();
  return { ...actual, verifyUserToken: vi.fn() };
});

vi.mock("@/lib/dm", () => ({
  sendDm: vi.fn(async () => ({ ok: true })),
  getConversations: vi.fn(async () => []),
  getThread: vi.fn(async () => []),
  markThreadRead: vi.fn(async () => {}),
  getUnreadDmCount: vi.fn(async () => 0),
}));

import { POST } from "@/app/api/dm/route";
import { verifyUserToken } from "@/lib/user-session";
import { sendDm } from "@/lib/dm";

const mockVerify = vi.mocked(verifyUserToken);
const session = (wallet: string | null) => mockVerify.mockReturnValue(wallet ? { wallet, exp: Date.now() + 1e6 } : null);

function req(body: unknown) {
  return new Request("http://x/api/dm", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `t-${Math.random()}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/dm — session & actor binding", () => {
  it("401 with no session", async () => {
    session(null);
    expect((await POST(req({ to: B, body: "hi", actor: A }))).status).toBe(401);
  });

  it("401 (stale) when the connected wallet differs from the cookie's", async () => {
    session(A);
    const res = await POST(req({ to: B, body: "hi", actor: B }));
    expect(res.status).toBe(401);
    expect((await res.json()).stale).toBe(true);
    expect(sendDm).not.toHaveBeenCalled();
  });

  it("400 on an invalid recipient", async () => {
    session(A);
    expect((await POST(req({ to: "nope", body: "hi", actor: A }))).status).toBe(400);
  });

  it("400 on an empty body", async () => {
    session(A);
    expect((await POST(req({ to: B, body: "   ", actor: A }))).status).toBe(400);
    expect(sendDm).not.toHaveBeenCalled();
  });

  it("sends as the cookie wallet on a valid request", async () => {
    session(A);
    const res = await POST(req({ to: B, body: "gm", actor: A }));
    expect(res.status).toBe(200);
    expect(sendDm).toHaveBeenCalledWith(A, B, "gm");
  });
});
