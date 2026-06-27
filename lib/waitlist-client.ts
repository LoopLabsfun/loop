// Client fetch helper for the launch waitlist. Pure network call — the optional
// connected wallet is passed by the caller (the form reads it from useWallet).
// Lives outside lib/waitlist (which is server-only) so the client form can import
// the shared cap without pulling `server-only` into the browser bundle.

/** Max length of the optional "what do you want to build?" idea field. */
export const IDEA_MAX = 280;

export interface WaitlistFields {
  wallet?: string | null;
  email?: string | null;
  xHandle?: string | null;
  idea?: string | null;
  referrer?: string | null;
}

/**
 * Join the waitlist. `already` = the signer was on it already; `messaged` = we
 * opened a welcome DM on the platform (only on a fresh wallet signup).
 */
export async function apiJoinWaitlist(
  fields: WaitlistFields,
): Promise<{ already: boolean; messaged: boolean }> {
  const r = await fetch("/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Could not join the waitlist.");
  return { already: Boolean(j.already), messaged: Boolean(j.messaged) };
}
