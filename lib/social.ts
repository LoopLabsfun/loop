import "server-only";
import { supabaseAdmin } from "./supabase";
import { getProjects } from "./queries";

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

export type NotificationType = "follow" | "escalation" | "dm";

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

/** Does `actor` follow `target`? */
export async function isFollowing(actor: string, target: string): Promise<boolean> {
  const sb = supabaseAdmin;
  if (!sb || actor === target) return false;
  const { data } = await sb
    .from("follows")
    .select("follower")
    .eq("follower", actor)
    .eq("following", target)
    .maybeSingle();
  return Boolean(data);
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

/** Wallets that ARE platform infrastructure (an official project's on-chain
 *  creator/treasury, e.g. LOOP's 7kyek…) — real people to discover, they're not.
 *  Kept out of the People surfaces below so an infra wallet never shows up as
 *  "a person named Loop" with a Follow button (still visible via direct /u/ link,
 *  badged — see ProfileView's isPlatformWallet). */
async function getPlatformWallets(): Promise<Set<string>> {
  const projects = await getProjects();
  const wallets = new Set<string>();
  for (const p of projects) {
    if (!p.official) continue;
    if (p.creatorWallet) wallets.add(p.creatorWallet);
    if (p.treasuryWallet) wallets.add(p.treasuryWallet);
  }
  return wallets;
}

const PLATFORM_LIMIT_PAD = 8; // headroom so filtering out platform wallets doesn't starve the page below `limit`.

/** Recently-joined profiles that have set at least a display name or username —
 *  people worth discovering on Explore. Excludes the viewer and platform wallets. */
export async function getRecentProfiles(viewer?: string | null, limit = 24): Promise<SocialUser[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const [{ data }, platform] = await Promise.all([
    sb
      .from("profiles")
      .select("wallet,display_name,avatar_url,username")
      .or("display_name.not.is.null,username.not.is.null")
      .order("created_at", { ascending: false })
      .limit(limit + PLATFORM_LIMIT_PAD),
    getPlatformWallets(),
  ]);
  const wallets = ((data ?? []) as { wallet: string }[])
    .map((p) => p.wallet)
    .filter((w) => w !== viewer && !platform.has(w))
    .slice(0, limit);
  return enrich(wallets, viewer);
}

/** Search profiles by username or display name (prefix-friendly), enriched.
 *  Excludes platform wallets — see getRecentProfiles. */
export async function searchPeople(q: string, viewer?: string | null, limit = 12): Promise<SocialUser[]> {
  const sb = supabaseAdmin;
  const term = q.trim();
  if (!sb || term.length < 2) return [];
  const like = `%${term.replace(/[%_]/g, "")}%`;
  const [{ data }, platform] = await Promise.all([
    sb
      .from("profiles")
      .select("wallet")
      .or(`username.ilike.${like},display_name.ilike.${like}`)
      .limit(limit + PLATFORM_LIMIT_PAD),
    getPlatformWallets(),
  ]);
  const wallets = ((data ?? []) as { wallet: string }[]).map((p) => p.wallet).filter((w) => !platform.has(w)).slice(0, limit);
  return enrich(wallets, viewer);
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

/** Reconcile open escalations into the founder's notification feed. Escalations
 *  are created by the agent runtime (no in-app insert site), so instead of
 *  hooking creation we sync on read: every open escalation on a project this
 *  wallet launched becomes one notification, idempotently (deduped by the
 *  escalation id stored in `data`). Cheap no-op for non-founders. */
export async function syncEscalationNotifications(recipient: string): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) return;
  const { data: projs } = await sb.from("projects").select("key").eq("creator_wallet", recipient);
  const keys = ((projs ?? []) as { key: string }[]).map((p) => p.key);
  if (keys.length === 0) return;
  const { data: escs } = await sb
    .from("agent_escalations")
    .select("id,project_key,body")
    .in("project_key", keys)
    .eq("status", "open");
  const open = (escs ?? []) as { id: number; project_key: string; body: string }[];
  if (open.length === 0) return;
  // Which escalations already have a notification? (dedupe by stored id)
  const { data: existing } = await sb
    .from("notifications")
    .select("data")
    .eq("recipient", recipient)
    .eq("type", "escalation");
  const seen = new Set(
    ((existing ?? []) as { data: { escalationId?: number } }[]).map((n) => n.data?.escalationId).filter(Boolean)
  );
  const rows = open
    .filter((e) => !seen.has(e.id))
    .map((e) => ({
      recipient,
      type: "escalation",
      actor: null,
      data: { escalationId: e.id, projectKey: e.project_key, text: e.body.slice(0, 140) },
      read: false,
    }));
  if (rows.length > 0) await sb.from("notifications").insert(rows);
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
