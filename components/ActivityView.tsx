"use client";

import Link from "next/link";
import { LoopMark } from "./LoopMark";
import { useWallet } from "@/lib/wallet";
import { NotificationBell } from "./NotificationBell";
import { ProfileIcon } from "./AuthIcons";
import { ActivityFeed } from "./ActivityFeed";
import type { ActivityItem } from "@/lib/activity";

// The /activity page: Loop's social pulse, with the standard wallet-aware nav.
export function ActivityView({ items }: { items: ActivityItem[] }) {
  const wallet = useWallet();
  return (
    <div className="min-h-screen">
      <nav className="border-b border-line max-w-[1280px] mx-auto px-6 sm:px-8 h-[60px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-[10px]">
          <LoopMark width={24} height={15} stroke="var(--accent)" />
          <span className="font-display font-bold text-[16px] tracking-[-0.02em]">Loop</span>
        </Link>
        <div className="flex items-center gap-[8px]">
          {wallet.connected && (
            <>
              <NotificationBell />
              <Link
                href="/profile"
                title="Your Loop profile"
                className="hidden sm:flex items-center justify-center w-[38px] h-[38px] rounded-[10px] border border-line-3 bg-surface text-muted hover:text-accent-text hover:border-line-hover transition-colors"
              >
                <ProfileIcon size={17} />
              </Link>
            </>
          )}
          <button
            onClick={wallet.toggle}
            className="font-mono text-[12px] px-3 py-[7px] rounded-[10px] border border-line-3 hover:border-line-hover transition-colors"
          >
            {wallet.label}
          </button>
        </div>
      </nav>

      <main className="max-w-[680px] mx-auto px-6 sm:px-8 py-7">
        <div className="mb-4">
          <h1 className="font-display font-bold text-[24px] tracking-[-0.02em] m-0">Activity</h1>
          <p className="text-[13px] text-muted mt-1 mb-0">The live pulse of Loop — launches, ships, follows, and new builders.</p>
        </div>
        <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-3">
          <ActivityFeed items={items} />
        </div>
      </main>
    </div>
  );
}
