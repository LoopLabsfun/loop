import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { getAgentState } from "@/lib/agent-data";
import { runAgentTick, agentRuntimeConfigured } from "@/lib/agent-runtime";
import { isXConfigured, verifyXCredentials } from "@/lib/x-send";
import { isTelegramConfigured } from "@/lib/telegram-send";
import { agentWalletConfigured } from "@/lib/agent-wallet";

// Run one autonomous agent tick for a project: read its mandate + steering
// directives + current tasks, ask Claude for the next action, persist it.
// Intended to be driven by a scheduler (cron / Trigger.dev), so it's gated by a
// shared secret rather than open to the world.
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // the Anthropic SDK needs the Node runtime

export async function POST(req: Request) {
  const secret = process.env.AGENT_TICK_SECRET;
  if (!secret || req.headers.get("x-agent-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!agentRuntimeConfigured()) {
    return NextResponse.json(
      { error: "agent runtime not configured (set ANTHROPIC_API_KEY)" },
      { status: 503 }
    );
  }

  let key: string | undefined;
  let diagTweet = false;
  try {
    const body = await req.json();
    key = body?.key;
    diagTweet = body?.diagTweet === true;
  } catch {
    /* no/invalid body */
  }
  if (!key) {
    return NextResponse.json({ error: "missing project key" }, { status: 400 });
  }

  // One-off diagnostic: post a UNIQUE (timestamped) tweet and return the raw
  // result, so we can see the exact X failure (e.g. 403 duplicate vs 403 write
  // permission) without spamming. Unique text dodges duplicate-content rejection.
  if (diagTweet) {
    const { sendTweet } = await import("@/lib/x-send");
    const r = await sendTweet(
      `LOOP build heartbeat · ${new Date().toISOString()} — agent online.`
    );
    return NextResponse.json({ diagTweet: r });
  }

  const project = await getProject(key);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  try {
    const state = await getAgentState(project);
    const decision = await runAgentTick(project, {
      tasks: state.tasks,
      directives: state.directives,
    });
    // Non-secret diagnostics: which delivery channels the prod runtime actually
    // sees configured (booleans only — never the keys themselves).
    const integrations = {
      x: isXConfigured(),
      telegram: isTelegramConfigured(),
      agentWallet: agentWalletConfigured(),
      // HTTP status of an X credential check (200 = valid creds). Diagnostic.
      xAuthStatus: await verifyXCredentials(),
    };
    return NextResponse.json(
      { key: project.key, decision, integrations },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "agent tick failed" },
      { status: 500 }
    );
  }
}
