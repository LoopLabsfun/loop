import { NextResponse } from "next/server";
import { getComputePoolStats } from "@/lib/device-assists";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public Loop Compute pool stats — how many devices are contributing, how many
 * assists they've produced, per project. Read-only, no secrets: a recruiting
 * surface anyone can hit, and the data behind a future "Compute pool" widget.
 */
export async function GET() {
  const stats = await getComputePoolStats();
  return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
}
