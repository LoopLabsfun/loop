"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { apiFollow, apiEstablishSession, apiFollowState } from "@/lib/social-client";

// Reusable follow/unfollow control. Optimistic; on a 401 (no session) it asks the
// wallet to sign ONE profile proof to open a 7-day session, then retries — so
// following is one click after the first sign, never a popup per follow.
//
// - `following` seeds the state when the caller already knows it (the profile
//   page resolves it server-side).
// - `autoState` fetches the state on mount instead — for places that render
//   without it (the holder drawer).
// - `size` switches between the page-level CTA and a compact inline pill.
export function FollowButton({
  target,
  following: initial = false,
  autoState = false,
  size = "lg",
  onChange,
}: {
  target: string;
  following?: boolean;
  autoState?: boolean;
  size?: "lg" | "sm";
  onChange?: (now: boolean) => void;
}) {
  const wallet = useWallet();
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);

  // Hide on your own wallet (you can't follow yourself).
  const isSelf = wallet.connected && wallet.address === target;

  useEffect(() => {
    if (autoState && wallet.connected) apiFollowState(target, wallet.address).then(setFollowing).catch(() => {});
  }, [autoState, wallet.connected, wallet.address, target]);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!wallet.connected || !wallet.address) {
      wallet.connect();
      return;
    }
    const next = !following;
    setBusy(true);
    setFollowing(next);
    onChange?.(next);
    try {
      await apiFollow(target, next ? "follow" : "unfollow", wallet.address);
    } catch (err) {
      if (err instanceof Error && err.message === "no-session") {
        try {
          const proof = await wallet.signProfileProof(wallet.address);
          if (proof && (await apiEstablishSession(wallet.address, proof))) {
            await apiFollow(target, next ? "follow" : "unfollow", wallet.address);
          } else {
            setFollowing(!next);
            onChange?.(!next);
          }
        } catch {
          setFollowing(!next);
          onChange?.(!next);
        }
      } else {
        setFollowing(!next);
        onChange?.(!next);
      }
    } finally {
      setBusy(false);
    }
  }

  if (isSelf) return null;

  const label = !wallet.connected ? "Follow" : following ? (hover ? "Unfollow" : "Following") : "Follow";
  const sm = size === "sm";
  const base = sm
    ? "font-mono text-[11px] px-[10px] h-[26px] rounded-[8px]"
    : "font-display font-semibold text-[13px] px-4 h-[36px] rounded-[10px]";
  const tone = following
    ? hover
      ? "bg-neg/10 text-neg border border-neg/30"
      : "bg-surface text-muted border border-line-2"
    : "bg-accent text-white hover:opacity-90";
  return (
    <button
      onClick={toggle}
      disabled={busy}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`${base} ${tone} inline-flex items-center justify-center transition-colors disabled:opacity-60 flex-none`}
    >
      {busy ? "…" : label}
    </button>
  );
}
