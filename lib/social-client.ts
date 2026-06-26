import type { LaunchProof } from "./signature";
import type { Notification } from "./social";

// Client fetch helpers for Loop's social layer. Pure network calls — the wallet
// signing lives in the components (via useWallet) so these stay dependency-free.

/** Establish a 7-day user session from one signed profile proof. */
export async function apiEstablishSession(wallet: string, proof: LaunchProof): Promise<boolean> {
  const r = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, proof }),
  });
  return r.ok;
}

/** Follow / unfollow `target`. Returns the new following state, or throws on a
 *  missing session so the caller can establish one and retry. */
export async function apiFollow(target: string, action: "follow" | "unfollow"): Promise<boolean> {
  const r = await fetch("/api/follow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, action }),
  });
  if (r.status === 401) throw new Error("no-session");
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "follow failed");
  return Boolean(j.following);
}

/** Load the signed-in wallet's notifications. 401 ⇒ no session (throws). */
export async function apiLoadNotifications(): Promise<{ items: Notification[]; unread: number }> {
  const r = await fetch("/api/notifications");
  if (r.status === 401) throw new Error("no-session");
  if (!r.ok) throw new Error("load failed");
  return r.json();
}

/** Mark all notifications read. */
export async function apiMarkNotificationsRead(): Promise<void> {
  await fetch("/api/notifications", { method: "POST" });
}
