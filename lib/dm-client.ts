import type { Conversation, DmMessage } from "./dm";

// Client fetch helpers for DMs. A 401 means no session — the caller establishes
// one (apiEstablishSession) and retries, same flow as follow/notifications.

export async function apiDmConversations(): Promise<{ conversations: Conversation[]; unread: number }> {
  const r = await fetch("/api/dm");
  if (r.status === 401) throw new Error("no-session");
  if (!r.ok) throw new Error("load failed");
  return r.json();
}

export async function apiDmThread(peer: string): Promise<DmMessage[]> {
  const r = await fetch(`/api/dm?with=${encodeURIComponent(peer)}`);
  if (r.status === 401) throw new Error("no-session");
  if (!r.ok) throw new Error("load failed");
  return (await r.json()).messages;
}

export async function apiDmSend(to: string, body: string): Promise<void> {
  const r = await fetch("/api/dm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to, body }),
  });
  if (r.status === 401) throw new Error("no-session");
  if (!r.ok) throw new Error((await r.json()).error || "send failed");
}
