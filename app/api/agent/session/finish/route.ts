import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { parseHandsOutput } from "@/lib/repo-hands";
import { applyDecision, type AgentDecision } from "@/lib/agent-runtime";
import type { TaskCategory } from "@/lib/agent";

// Persist callback for a Trigger.dev agent-session run (trigger/agent-session.ts).
// The durable task runs the E2B SDK session, then POSTs the raw sandbox stdout
// here; we parse the markers (parseHandsOutput) and persist via applyDecision —
// which keeps the verifier gate honest (shipped only when PUSHED=yes) and fans the
// build update out to the task feed + socials. Gated by the shared agent secret.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORIES: TaskCategory[] = ["feature", "outreach", "fix", "ops"];

export async function POST(req: Request) {
  const secret = process.env.AGENT_TICK_SECRET;
  if (!secret || req.headers.get("x-agent-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    key?: string;
    title?: string;
    detail?: string;
    category?: string;
    stdout?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { key, title, detail, category, stdout } = body;
  if (!key || !title || typeof stdout !== "string") {
    return NextResponse.json({ error: "missing key/title/stdout" }, { status: 400 });
  }

  const project = await getProject(key);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const hands = parseHandsOutput(stdout);
  const cat: TaskCategory = CATEGORIES.includes(category as TaskCategory)
    ? (category as TaskCategory)
    : "feature";
  const decision: AgentDecision = {
    summary: `sdk-hands: ${hands.note}`.slice(0, 280),
    task: {
      title: String(title).slice(0, 120),
      detail: String(detail ?? "").slice(0, 500),
      category: cat,
      // Maker self-reports "shipped"; applyDecision's verifier gate only KEEPS it
      // shipped when the check below passed (PUSHED=yes) — else held at building.
      status: "shipped",
    },
  };
  const verify = {
    checkerId: "verifier:e2b-sdk-hands",
    checks: [
      {
        kind: "test" as const,
        name: "e2b:sdk-hands",
        passed: hands.pushed,
        detail: hands.note,
      },
    ],
  };

  try {
    await applyDecision(project, decision, verify);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "persist failed" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { key, pushed: hands.pushed, gatePassed: hands.gatePassed, note: hands.note, commitSha: hands.commitSha },
    { headers: { "Cache-Control": "no-store" } }
  );
}
