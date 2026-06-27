import type { Metadata } from "next";
import { getActivityFeed } from "@/lib/activity";
import { ActivityView } from "@/components/ActivityView";

// The global activity feed — Loop's social pulse. force-dynamic: it's a live read
// of launches/ships/follows/joins, never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Activity — Loop" };

export default async function ActivityPage() {
  const items = await getActivityFeed(50);
  return <ActivityView items={items} />;
}
