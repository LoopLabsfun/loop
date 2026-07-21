"use client";

import { SiteHeader } from "./SiteHeader";
import { ActivityFeed } from "./ActivityFeed";
import type { ActivityItem } from "@/lib/activity";

// The /activity page: Loop's social pulse, with the shared site header.
export function ActivityView({ items }: { items: ActivityItem[] }) {
  return (
    <div className="min-h-screen">
      <SiteHeader context="activity" />

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
