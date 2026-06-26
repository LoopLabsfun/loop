// Canonical message a user signs to prove wallet ownership when editing their
// Loop PROFILE. Same `<ns>\n…\nts:<ms>` shape as the other signed-message
// namespaces, with an anti-replay timestamp.
//
// BRAND: this is a NEW namespace, and the user sees this text in their wallet when
// they sign — so it uses the brand domain `looplabs.fun`, NOT `loop.fun`. (The
// pre-existing stake/directive/chat namespaces stay `loop.fun` only because
// changing them would invalidate already-issued signatures — do not "fix" those.)
//
// Pure + dependency-free so it's shared verbatim by the wallet (to sign) and the
// server (to verify), guaranteeing the two never drift.
export function buildProfileMessage(wallet: string, ts: number): string {
  return `looplabs.fun profile\nwallet:${wallet}\nts:${ts}`;
}
