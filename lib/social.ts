import "server-only";
import { supabaseAdmin } from "./supabase";

// Server-only seam for Loop's social graph: wallet-to-wallet follows and the
// per-recipient notification feed. Public follow data is readable directly; all
// writes and all notification reads happen here behind the service role, gated by
// a signed `looplabs.fun profile` proof at the API boundary (lib/social tables
// have no anon write policy — same posture as profiles). Never throws on a cold
// or unconfigured backend: counts fall back to 0, lists to [].

/** A wallet in a follower/following list, enriched with its profile basics. */
export interface SocialUser {
  wallet: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Does the VIEWER (if any) already follow this wallet? */
  youFollow: boolean;
}

export interface FollowState {
  followers: number;
  following: number;
  /** True when `viewer` follows `wallet` (false when no viewer / self). */
  youFollow: boolean;
}

export type NotificationType = "follow" | "escalation";

export interface Notification {
  id: number;
  type: NotificationType;
  actor: string | null;
  /** Profile basics for `actor`, when it's a wallet with a profile. */
  actorName: string | null;
  actorAvatar: string | null;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

/** Follower/following counts for `wallet`, plus whether `viewer` follows it. */
export async function getFollowState(wallet: string, viewer?: string | null): Promise<FollowState> {
  const sb = supabaseAdmin;
  if (!sb) return { followers: 0, following: 0, youFollow: false };
  const [followers, following, youFollow] = await Promise.all([
    sb.from("follows").select("*", { count: "exact", head: true }).eq("following", wallet),
    sb.from("follows").select("*", { count: "exact", head: true }).eq("follower", wallet),
    viewer && viewer !== wallet
      ? sb.from("follows").select("follower", { head: false }).eq("follower", viewer).eq("following", wallet).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    followers: followers.count ?? 0,
    following: following.count ?? 0,
    youFollow: Boolean((youFollow as { data: unknown }).data),
  };
}

/** Enrich a set of wallets with profile basics + whether `viewer` follows each. */
async function enrich(wallets: string[], viewer?: string | null): Promise<SocialUser[]> {
  const sb = supabaseAdmin;
  if (!sb || wallets.length === 0) return [];
  const [profilesR, mineR] = await Promise.all([
    sb.from("profiles").select("wallet,display_name,avatar_url").in("wallet", wallets),
    viewer ? sb.from("follows").select("following").eq("follower", viewer).in("following", wallets) : Promise.resolve({ data: [] }),
  ]);
  const byWallet = new Map(
    ((profilesR.data ?? []) as { wallet: string; display_name: string | null; avatar_url: string | null }[]).map((p) => [
      p.wallet,
      p,
    ])
  );
  const mine = new Set(((mineR.data ?? []) as { following: string }[]).map((r) => r.following));
  return wallets.map((w) => ({
    wallet: w,
    displayName: byWallet.get(w)?.display_name ?? null,
    avatarUrl: byWallet.get(w)?.avatar_url ?? null,
    youFollow: mine.has(w),
  }));
}

/** Wallets that follow `wallet` (newest first), enriched. */
export async function getFollowers(wallet: string, viewer?: string | null, limit = 50): Promise<SocialUser[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const { data } = await sb
    .from("follows")
    .select("follower")
    .eq("following", wallet)
    .order("created_at", { ascending: false })
    .limit(limit);
  return enrich(((data ?? []) as { follower: string }[]).map((r) => r.follower), viewer);
}

/** Wallets `wallet` follows (newest first), enriched. */
export async function getFollowing(wallet: string, viewer?: string | null, limit = 50): Promise<SocialUser[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const { data } = await sb
    .from("follows")
    .select("following")
    .eq("follower", wallet)
    .order("created_at", { ascending: false })
    .limit(limit);
  return enrich(((data ?? []) as { following: string }[]).map((r) => r.following), viewer);
}

/** Follow `target` as `actor` (idempotent) and notify the target. */
export async function follow(actor: string, target: string): Promise<{ ok: boolean; error?: string }> {
  if (actor === target) return { ok: false, error: "cannot follow yourself" };
  const sb = supabaseAdmin;
  if (!sb) return { ok: false, error: "not configured" };
  const { error } = await sb.from("follows").upsert({ follower: actor, following: target }, { onConflict: "follower,following" });
  if (error) return { ok: false, error: error.message };
  // Notify the target — upsert on the (recipient, actor) follow uniqueness so a
  // re-follow refreshes (and un-reads) the existing row rather than duplicating.
  await sb.from("notifications").upsert(
    { recipient: target, type: "follow", actor, data: {}, read: false, created_at: new Date().toISOString() },
    { onConflict: "recipient,actor", ignoreDuplicates: false }
  );
  return { ok: true };
}

/** Unfollow `target` as `actor` (idempotent). Leaves any past notification. */
export async function unfollow(actor: string, target: string): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin;
  if (!sb) return { ok: false, error: "not configured" };
  const { error } = await sb.from("follows").delete().eq("follower", actor).eq("following", target);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** The recipient's notifications (newest first), with actor profile basics. */
export async function getNotifications(recipient: string, limit = 30): Promise<Notification[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const { data } = await sb
    .from("notifications")
    .select("id,type,actor,data,read,created_at")
    .eq("recipient", recipient)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as {
    id: number;
    type: NotificationType;
    actor: string | null;
    data: Record<string, unknown>;
    read: boolean;
    created_at: string;
  }[];
  const actors = Array.from(new Set(rows.map((r) => r.actor).filter((a): a is string => Boolean(a))));
  const profiles =
    actors.length > 0
      ? await sb.from("profiles").select("wallet,display_name,avatar_url").in("wallet", actors)
      : { data: [] };
  const byWallet = new Map(
    ((profiles.data ?? []) as { wallet: string; display_name: string | null; avatar_url: string | null }[]).map((p) => [
      p.wallet,
      p,
    ])
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    actor: r.actor,
    actorName: r.actor ? byWallet.get(r.actor)?.display_name ?? null : null,
    actorAvatar: r.actor ? byWallet.get(r.actor)?.avatar_url ?? null : null,
    data: r.data ?? {},
    read: r.read,
    createdAt: r.created_at,
  }));
}

/** Count of unread notifications for `recipient`. */
export async function getUnreadCount(recipient: string): Promise<number> {
  const sb = supabaseAdmin;
  if (!sb) return 0;
  const { count } = await sb
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("recipient", recipient)
    .eq("read", false);
  return count ?? 0;
}

/** Mark all of the recipient's notifications read. */
export async function markAllRead(recipient: string): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) return;
  await sb.from("notifications").update({ read: true }).eq("recipient", recipient).eq("read", false);
}
