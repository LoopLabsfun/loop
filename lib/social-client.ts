import type { LaunchProof } from "./signature";
import type { Notification } from "./social";

// Client fetch helpers for Loop's social layer. Pure network calls — the wallet
// signing lives in the components (via useWallet) so these stay dependency-free.

// Remember which wallet the active session belongs to, so a wallet switch in the
// same browser can detect a now-stale session and clear it (the cookie is
// httpOnly, so the client can't read the wallet from it directly).
const SESSION_WALLET_KEY = "loop_session_wallet";

export function rememberSessionWallet(wallet: string) {
  try {
    localStorage.setItem(SESSION_WALLET_KEY, wallet);
  } catch {
    /* ignore */
  }
}
export function sessionWallet(): string | null {
  try {
    return localStorage.getItem(SESSION_WALLET_KEY);
  } catch {
    return null;
  }
}

/** The wallet the current session cookie belongs to (server truth), or null.
 *  The cookie is httpOnly so this is the only way the client can learn it —
 *  used to detect a stale session left over from a previous wallet. */
export async function apiSessionWallet(): Promise<string | null> {
  try {
    const r = await fetch("/api/session");
    if (!r.ok) return null;
    return (await r.json()).wallet ?? null;
  } catch {
    return null;
  }
}

/** Establish a 7-day user session from one signed profile proof. */
export async function apiEstablishSession(wallet: string, proof: LaunchProof): Promise<boolean> {
  const r = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, proof }),
  });
  if (r.ok) rememberSessionWallet(wallet);
  return r.ok;
}

/** Clear the user session (cookie + remembered wallet). Called on wallet switch. */
export async function apiClearSession(): Promise<void> {
  try {
    localStorage.removeItem(SESSION_WALLET_KEY);
  } catch {
    /* ignore */
  }
  try {
    await fetch("/api/session", { method: "DELETE" });
  } catch {
    /* ignore */
  }
}

/** Follow / unfollow `target`. Returns the new following state, or throws on a
 *  missing/stale session so the caller can establish one and retry. `actor` is
 *  the connected wallet — the server rejects (401) if the cookie is for another
 *  wallet, so the action is never written under a stale session. */
export async function apiFollow(target: string, action: "follow" | "unfollow", actor?: string | null): Promise<boolean> {
  const r = await fetch("/api/follow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, action, actor }),
  });
  if (r.status === 401) throw new Error("no-session");
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "follow failed");
  return Boolean(j.following);
}

/** Whether the signed-in wallet follows `target` (false when no session). The
 *  `actor` hint lets the server ignore a stale cookie for a different wallet. */
export async function apiFollowState(target: string, actor?: string | null): Promise<boolean> {
  try {
    const q = `target=${encodeURIComponent(target)}${actor ? `&actor=${encodeURIComponent(actor)}` : ""}`;
    const r = await fetch(`/api/follow?${q}`);
    if (!r.ok) return false;
    return Boolean((await r.json()).following);
  } catch {
    return false;
  }
}

/** Load the signed-in wallet's notifications. 401 ⇒ no/stale session (throws). */
export async function apiLoadNotifications(actor?: string | null): Promise<{ items: Notification[]; unread: number }> {
  const r = await fetch(`/api/notifications${actor ? `?actor=${encodeURIComponent(actor)}` : ""}`);
  if (r.status === 401) throw new Error("no-session");
  if (!r.ok) throw new Error("load failed");
  return r.json();
}

/** Mark all notifications read. */
export async function apiMarkNotificationsRead(): Promise<void> {
  await fetch("/api/notifications", { method: "POST" });
}
