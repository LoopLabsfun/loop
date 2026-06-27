import type { Conversation, DmMessage } from "./dm";

// Client fetch helpers for DMs. A 401 means no session — the caller establishes
// one (apiEstablishSession) and retries, same flow as follow/notifications.

// `actor` (the connected wallet) lets the server ignore a stale cookie for a
// different wallet — a 401 then drives the same re-sign flow as no-session.
export async function apiDmConversations(actor?: string | null): Promise<{ conversations: Conversation[]; unread: number }> {
  const r = await fetch(`/api/dm${actor ? `?actor=${encodeURIComponent(actor)}` : ""}`);
  if (r.status === 401) throw new Error("no-session");
  if (!r.ok) throw new Error("load failed");
  return r.json();
}

export async function apiDmThread(peer: string, actor?: string | null): Promise<DmMessage[]> {
  const q = `with=${encodeURIComponent(peer)}${actor ? `&actor=${encodeURIComponent(actor)}` : ""}`;
  const r = await fetch(`/api/dm?${q}`);
  if (r.status === 401) throw new Error("no-session");
  if (!r.ok) throw new Error("load failed");
  return (await r.json()).messages;
}

// `actor` is the connected wallet — the server rejects (401) if the session
// cookie is for another wallet, so a DM is never sent under a stale session.
export async function apiDmSend(to: string, body: string, actor?: string | null): Promise<void> {
  const r = await fetch("/api/dm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to, body, actor }),
  });
  if (r.status === 401) throw new Error("no-session");
  if (!r.ok) throw new Error((await r.json()).error || "send failed");
}
