"use client";

import { useCallback } from "react";
import { useWallet } from "./wallet";
import { useHoodWallet } from "./chains/hood-wallet";
import { apiEstablishSession, apiEstablishSessionFromEvm } from "./social-client";
import { buildEvmSignInMessage } from "./evm-link-message";

// ONE identity, either wallet.
//
// Social surfaces (DMs, notifications, follow) used to require a SOLANA wallet
// specifically, because that's what the session was minted from. On a dual-chain
// product that's wrong: a user who came for Hood and has only their EVM wallet
// connected is the same person, and was being told to go find another wallet to
// read their own messages.
//
// This resolves whichever wallet is available to the SAME session. It does not
// remove the signature — that's the login, and dropping it would let anyone read
// anyone's DMs by naming their address. It removes the assumption that the login
// has to come from Solana.
//
// Solana is preferred when both are connected: it's the root identity, so it
// works even for a profile that never linked an EVM address.

export interface SessionResult {
  ok: boolean;
  /** The Loop identity (a Solana wallet) the session was opened for. */
  wallet?: string;
  error?: string;
}

export function useEnsureSession(): () => Promise<SessionResult> {
  const sol = useWallet();
  const hood = useHoodWallet();

  return useCallback(async (): Promise<SessionResult> => {
    if (sol.address) {
      const proof = await sol.signProfileProof(sol.address);
      if (!proof) return { ok: false, error: "signature declined" };
      const ok = await apiEstablishSession(sol.address, proof);
      return ok ? { ok: true, wallet: sol.address } : { ok: false, error: "sign-in failed" };
    }

    if (hood.address) {
      const ts = Date.now();
      const message = buildEvmSignInMessage(hood.address, ts);
      const signature = await hood.signMessage(message);
      if (!signature) return { ok: false, error: "signature declined" };
      const res = await apiEstablishSessionFromEvm({ address: hood.address, signature, ts });
      return "error" in res ? { ok: false, error: res.error } : { ok: true, wallet: res.wallet };
    }

    return { ok: false, error: "connect a wallet first" };
  }, [sol, hood]);
}
