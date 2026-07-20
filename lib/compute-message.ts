// Canonical message a wallet signs to ENROLL a browser/device node in the Loop
// Compute pool. The ed25519 proof (verifyComputeEnrollProof) is the whole beta
// onboarding: prove the wallet once, receive a stateless device token bound to
// it, earn to it. Mirrors buildChatMessage; the trailing `ts:` enables
// anti-replay. ("loop.fun" here is a signed-message namespace, not branding —
// it must stay stable or every enrolled device would need to re-enroll.)

export function buildComputeEnrollMessage(wallet: string, ts: number): string {
  return `loop.fun compute\nenroll device for wallet:${wallet}\nts:${ts}`;
}

/** deviceId a wallet's browser node enrolls as — one identity per wallet. */
export function computeDeviceId(wallet: string): string {
  return `web-${wallet}`;
}

/** Short human label for the pool leaderboard ("web·7kye…cmm9"). */
export function computeDeviceName(wallet: string): string {
  return `web·${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}
