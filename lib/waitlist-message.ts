// Canonical message a user signs to pre-launch their project on the waitlist. The
// signature proves wallet ownership — signing in IS creating the account — so the
// server can trust `proof.pubkey` as the authenticated wallet and tie the draft +
// the welcome DM to it. Same `<ns>\n…\nts:<ms>` shape as the other namespaces,
// with an anti-replay timestamp.
//
// BRAND: this is a NEW namespace, and the user sees this text in their wallet when
// they sign — so it uses the brand domain `looplabs.fun`, NOT `loop.fun`. (The
// pre-existing stake/directive/chat namespaces stay `loop.fun` only because
// changing them would invalidate already-issued signatures — do not "fix" those.)
//
// Pure + dependency-free so it's shared verbatim by the wallet (to sign) and the
// server (to verify), guaranteeing the two never drift. No funds are moved.
export function buildWaitlistMessage(wallet: string, ts: number): string {
  return [
    "looplabs.fun — pre-launch a project",
    `wallet:${wallet}`,
    "Signing proves you control this wallet. No funds are moved.",
    `ts:${ts}`,
  ].join("\n");
}
