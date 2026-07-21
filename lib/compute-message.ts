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

// Linking a Hood (EVM) payout wallet alongside the Solana one that owns this
// device — needed once LOOP has both a Solana AND a Hood treasury: a task
// funded by the Solana side pays SOL, a Hood-funded one pays ETH, so a
// contributor's device needs both destinations on file. BOTH wallets sign
// this exact same message (ed25519 for the Solana side via verifyWalletSignature,
// EIP-191 for the Hood side via verifyEvmPersonalSign) — a mutual proof that
// neither wallet can produce alone, so a device can't link someone else's
// payout address to itself.
export function buildHoodLinkMessage(solanaWallet: string, hoodAddress: string, ts: number): string {
  return `loop.fun compute\nlink hood payout ${hoodAddress.toLowerCase()} to wallet:${solanaWallet}\nts:${ts}`;
}
