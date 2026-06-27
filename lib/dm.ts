import "server-only";
import { supabaseAdmin } from "./supabase";

// Server-only seam for wallet-to-wallet DMs. All access is gated by a signed-proof
// user session at the API boundary; this layer only ever takes the authenticated
// wallet from the caller, never trusts a body. Best-effort: cold backend ⇒ [].

export interface DmMessage {
  id: number;
  sender: string;
  recipient: string;
  body: string;
  read: boolean;
  createdAt: string;
  /** True when the authenticated viewer sent it. */
  mine: boolean;
}

/** One conversation in the inbox: the peer + the last message + unread count. */
export interface Conversation {
  peer: string;
  peerName: string | null;
  peerAvatar: string | null;
  lastBody: string;
  lastAt: string;
  /** Was the last message sent by the viewer? */
  lastMine: boolean;
  unread: number;
}

export const DM_MAX = 1000;

/** Send a DM from `sender` to `recipient`. Returns the stored row id. */
export async function sendDm(sender: string, recipient: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (sender === recipient) return { ok: false, error: "cannot message yourself" };
  const text = body.trim().slice(0, DM_MAX);
  if (!text) return { ok: false, error: "empty message" };
  const sb = supabaseAdmin;
  if (!sb) return { ok: false, error: "not configured" };
  const { error } = await sb.from("messages").insert({ sender, recipient, body: text });
  if (error) return { ok: false, error: error.message };
  // Notify the recipient, collapsed to one unread 'dm' per peer (the follow
  // unique index is partial to type='follow', so we can't upsert here — clear any
  // prior unread dm from this sender, then insert a fresh one).
  await sb.from("notifications").delete().eq("recipient", recipient).eq("actor", sender).eq("type", "dm").eq("read", false);
  await sb.from("notifications").insert({ recipient, type: "dm", actor: sender, data: { text: text.slice(0, 140) }, read: false });
  return { ok: true };
}

/** The viewer's conversations (one row per peer, latest first). */
export async function getConversations(viewer: string, limit = 40): Promise<Conversation[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const { data } = await sb
    .from("messages")
    .select("sender,recipient,body,read,created_at")
    .or(`sender.eq.${viewer},recipient.eq.${viewer}`)
    .order("created_at", { ascending: false })
    .limit(400);
  const rows = (data ?? []) as { sender: string; recipient: string; body: string; read: boolean; created_at: string }[];
  const byPeer = new Map<string, Conversation>();
  for (const r of rows) {
    const peer = r.sender === viewer ? r.recipient : r.sender;
    let c = byPeer.get(peer);
    if (!c) {
      c = { peer, peerName: null, peerAvatar: null, lastBody: r.body, lastAt: r.created_at, lastMine: r.sender === viewer, unread: 0 };
      byPeer.set(peer, c);
    }
    // Unread = messages TO the viewer not yet read.
    if (r.recipient === viewer && !r.read) c.unread += 1;
  }
  const convos = Array.from(byPeer.values()).slice(0, limit);
  // Enrich peers with profile basics.
  const peers = convos.map((c) => c.peer);
  if (peers.length > 0) {
    const { data: profs } = await sb.from("profiles").select("wallet,display_name,avatar_url").in("wallet", peers);
    const map = new Map(((profs ?? []) as { wallet: string; display_name: string | null; avatar_url: string | null }[]).map((p) => [p.wallet, p]));
    for (const c of convos) {
      c.peerName = map.get(c.peer)?.display_name ?? null;
      c.peerAvatar = map.get(c.peer)?.avatar_url ?? null;
    }
  }
  return convos;
}

/** The full thread between `viewer` and `peer` (oldest first). */
export async function getThread(viewer: string, peer: string, limit = 100): Promise<DmMessage[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const { data } = await sb
    .from("messages")
    .select("id,sender,recipient,body,read,created_at")
    .or(`and(sender.eq.${viewer},recipient.eq.${peer}),and(sender.eq.${peer},recipient.eq.${viewer})`)
    .order("created_at", { ascending: true })
    .limit(limit);
  return ((data ?? []) as { id: number; sender: string; recipient: string; body: string; read: boolean; created_at: string }[]).map((r) => ({
    id: r.id,
    sender: r.sender,
    recipient: r.recipient,
    body: r.body,
    read: r.read,
    createdAt: r.created_at,
    mine: r.sender === viewer,
  }));
}

/** Mark every message from `peer` to `viewer` as read. */
export async function markThreadRead(viewer: string, peer: string): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) return;
  await sb.from("messages").update({ read: true }).eq("recipient", viewer).eq("sender", peer).eq("read", false);
}

/** Total unread DMs across all conversations. */
export async function getUnreadDmCount(viewer: string): Promise<number> {
  const sb = supabaseAdmin;
  if (!sb) return 0;
  const { count } = await sb.from("messages").select("*", { count: "exact", head: true }).eq("recipient", viewer).eq("read", false);
  return count ?? 0;
}
