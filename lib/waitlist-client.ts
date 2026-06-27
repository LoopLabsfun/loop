// Client fetch helper for the launch waitlist. Pure network call — the optional
// connected wallet is passed by the caller (the form reads it from useWallet).

export interface WaitlistFields {
  wallet?: string | null;
  email?: string | null;
  xHandle?: string | null;
  idea?: string | null;
  referrer?: string | null;
}

/** Join the waitlist. Returns `{ already }` when the signer was on it already. */
export async function apiJoinWaitlist(fields: WaitlistFields): Promise<{ already: boolean }> {
  const r = await fetch("/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Could not join the waitlist.");
  return { already: Boolean(j.already) };
}
