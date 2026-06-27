import "server-only";
import { supabaseAdmin } from "./supabase";

// Server-only seam for the GLOBAL activity feed — the social pulse of Loop. It
// merges things that already happen across the platform into one time-sorted
// stream: agents shipping features, new projects launching, wallets following
// each other, and people joining. Read-only and best-effort; an empty/cold
// backend yields []. (Trades are per-token live data, not stored, so they're
// intentionally out of this cross-platform feed.)

export type ActivityKind = "ship" | "launch" | "follow" | "join";

export interface ActivityActor {
  wallet: string;
  name: string | null;
  avatar: string | null;
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  at: string;
  projectKey?: string;
  ticker?: string;
  text: string;
  actor?: ActivityActor | null;
  target?: ActivityActor | null;
}

export async function getActivityFeed(limit = 40): Promise<ActivityItem[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const [projectsR, shipsR, launchesR, followsR, joinsR] = await Promise.all([
    sb.from("projects").select("key,ticker"),
    sb.from("agent_tasks").select("id,project_key,title,updated_at").eq("status", "shipped").order("updated_at", { ascending: false }).limit(limit),
    sb.from("projects").select("key,name,ticker,created_at").order("created_at", { ascending: false }).limit(20),
    sb.from("follows").select("follower,following,created_at").order("created_at", { ascending: false }).limit(limit),
    sb.from("profiles").select("wallet,display_name,avatar_url,created_at").order("created_at", { ascending: false }).limit(20),
  ]);

  const tickerOf = new Map(((projectsR.data ?? []) as { key: string; ticker: string }[]).map((p) => [p.key, p.ticker]));

  // Resolve profile basics for every wallet referenced by follows/joins.
  const follows = (followsR.data ?? []) as { follower: string; following: string; created_at: string }[];
  const joins = (joinsR.data ?? []) as { wallet: string; display_name: string | null; avatar_url: string | null; created_at: string }[];
  const wallets = Array.from(new Set([...follows.flatMap((f) => [f.follower, f.following])]));
  const profilesR = wallets.length > 0 ? await sb.from("profiles").select("wallet,display_name,avatar_url").in("wallet", wallets) : { data: [] };
  const profile = new Map(
    ((profilesR.data ?? []) as { wallet: string; display_name: string | null; avatar_url: string | null }[]).map((p) => [p.wallet, p])
  );
  const actor = (w: string): ActivityActor => ({ wallet: w, name: profile.get(w)?.display_name ?? null, avatar: profile.get(w)?.avatar_url ?? null });

  const items: ActivityItem[] = [];

  // Ships — dedupe by title (the agent re-enqueues identical titles across cycles).
  const seenShip = new Set<string>();
  for (const t of (shipsR.data ?? []) as { id: number; project_key: string; title: string; updated_at: string }[]) {
    const k = t.title.trim().toLowerCase();
    if (seenShip.has(k)) continue;
    seenShip.add(k);
    items.push({
      id: `ship-${t.id}`,
      kind: "ship",
      at: t.updated_at,
      projectKey: t.project_key,
      ticker: tickerOf.get(t.project_key),
      text: t.title,
    });
  }

  for (const p of (launchesR.data ?? []) as { key: string; name: string; ticker: string; created_at: string }[]) {
    items.push({ id: `launch-${p.key}`, kind: "launch", at: p.created_at, projectKey: p.key, ticker: p.ticker, text: p.name });
  }

  for (const f of follows) {
    items.push({ id: `follow-${f.follower}-${f.following}`, kind: "follow", at: f.created_at, text: "", actor: actor(f.follower), target: actor(f.following) });
  }

  for (const j of joins) {
    items.push({
      id: `join-${j.wallet}`,
      kind: "join",
      at: j.created_at,
      text: "",
      actor: { wallet: j.wallet, name: j.display_name, avatar: j.avatar_url },
    });
  }

  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
