"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { useWallet } from "@/lib/wallet";

// "My profile" — a thin client redirect to /u/<your wallet> once connected, so the
// canonical profile URL is always wallet-keyed. Until then, a connect prompt.
export default function MyProfile() {
  const wallet = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (wallet.connected && wallet.address) router.replace(`/u/${wallet.address}`);
  }, [wallet.connected, wallet.address, router]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader context="profile" />
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="bg-surface border border-line-2 rounded-[16px] px-6 py-8 text-center max-w-[420px]">
          <div className="font-display font-semibold text-[16px] mb-1">Your Loop profile</div>
          <p className="text-[13px] text-muted mb-5">
            Connect your wallet to see your positions, the projects you&apos;ve launched, and your
            agent&apos;s log — your wallet is your profile.
          </p>
          <button
            onClick={wallet.connect}
            className="font-display font-semibold text-[14px] px-5 h-[40px] rounded-[10px] bg-accent text-white hover:opacity-90 transition-opacity"
          >
            Connect wallet
          </button>
        </div>
      </div>
    </div>
  );
}
