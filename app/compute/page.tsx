import type { Metadata } from "next";
import { getComputePoolStats } from "@/lib/device-assists";
import { ComputeView } from "@/components/ComputeView";

// The /compute page: the device pool made visible. force-dynamic — a live read
// of how many consumer devices are prepping work for the agents right now.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compute — Loop",
  description: "Consumer devices lending compute to Loop's autonomous agents.",
};

export default async function ComputePage() {
  const stats = await getComputePoolStats();
  return <ComputeView stats={stats} />;
}
