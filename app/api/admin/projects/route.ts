import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder } from "@/lib/admin-guard";
import { secretsConfigured } from "@/lib/project-secrets";
import {
  listAdminProjects,
  updateProjectFields,
  setProjectPaused,
  setProjectAgentKey,
  type ProjectFieldPatch,
} from "@/lib/admin-projects";

// PLATFORM-ADMIN project control. Gated on the LOOP creator_wallet (the platform
// super-admin), so the founder can administer EVERY project — third-party ones
// included — from one signed-in session.
//   GET            → every launched project + its mutable fields (+ hasAgentKey)
//   POST edit      → patch fields (fee %, description, prompt, repo, cover, steering)
//   POST set-key   → store a project's BYO Anthropic key (encrypted; write-only)
//   POST pause/resume → flip its agent's agent_paused
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function gate(req: Request) {
  const loop = await getProject("loop");
  if (!loop) return { error: NextResponse.json({ error: "loop project not found" }, { status: 404 }) };
  // Platform super-admin = the LOOP creator wallet (same session as the rest of /admin).
  if (!isFounder(req, loop)) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { ok: true as const };
}

export async function GET(req: Request) {
  const g = await gate(req);
  if ("error" in g) return g.error;
  // secretsArmed lets the UI distinguish "no key set" from "key store is off"
  // (PROJECT_SECRETS_KEY unset) — so set-key isn't offered when it can only fail.
  return NextResponse.json({
    projects: await listAdminProjects(),
    secretsArmed: secretsConfigured(),
  });
}

export async function POST(req: Request) {
  const g = await gate(req);
  if ("error" in g) return g.error;

  let body: { key?: string; action?: string; fields?: ProjectFieldPatch; anthropicKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const key = (body.key || "").trim();
  if (!/^[a-z0-9-]{1,60}$/.test(key)) {
    return NextResponse.json({ error: "valid project key required" }, { status: 400 });
  }

  try {
    if (body.action === "edit") {
      await updateProjectFields(key, body.fields ?? {});
      return NextResponse.json({ ok: true });
    }
    if (body.action === "set-key") {
      await setProjectAgentKey(key, String(body.anthropicKey ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "pause" || body.action === "resume") {
      await setProjectPaused(key, body.action === "pause");
      return NextResponse.json({ ok: true, paused: body.action === "pause" });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
