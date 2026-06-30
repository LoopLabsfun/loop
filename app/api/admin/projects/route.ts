import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder, adminWallet } from "@/lib/admin-guard";
import { secretsConfigured } from "@/lib/project-secrets";
import {
  listAdminProjects,
  updateProjectFields,
  setProjectPaused,
  setProjectAgentKey,
  restrictPatchForRole,
  type ProjectFieldPatch,
  type AdminRole,
} from "@/lib/admin-projects";

// PROJECT EDITING — two roles share one surface:
//   • LOOP super-admin (the LOOP creator_wallet) can administer EVERY project;
//   • a project's OWN creator_wallet can edit THEIR project's brand + social only.
// Both authenticate the same way (a wallet-signed session cookie, lib/admin-session);
// the difference is scope, enforced here per target project.
//   GET            → projects the caller may edit (all for super-admin, else own)
//   POST edit      → patch fields (creator: brand/social only; admin: everything)
//   POST set-key   → store a project's BYO Anthropic key  (super-admin only)
//   POST pause/resume → flip its agent's agent_paused      (super-admin only)
// Custom domains have their own route: /api/admin/projects/domain.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resolve the caller's identity: a valid session wallet + whether it's the LOOP
 *  super-admin. Returns an error response when there's no valid admin session. */
async function caller(req: Request) {
  const wallet = adminWallet(req);
  if (!wallet) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const loop = await getProject("loop");
  const isSuper = Boolean(loop && (await isFounder(req, loop)));
  return { wallet, isSuper };
}

export async function GET(req: Request) {
  const c = await caller(req);
  if ("error" in c) return c.error;
  const all = await listAdminProjects();
  // Super-admin sees every project; a creator sees only the ones they launched.
  const projects = c.isSuper ? all : all.filter((p) => p.creatorWallet === c.wallet);
  return NextResponse.json({
    projects,
    secretsArmed: secretsConfigured(),
    isSuper: c.isSuper,
  });
}

export async function POST(req: Request) {
  const c = await caller(req);
  if ("error" in c) return c.error;

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

  // Authorize against the TARGET project: the LOOP super-admin, or its own creator.
  const target = await getProject(key);
  if (!target) return NextResponse.json({ error: "project not found" }, { status: 404 });
  const isCreatorOfTarget = Boolean(target.creatorWallet && c.wallet === target.creatorWallet);
  if (!c.isSuper && !isCreatorOfTarget) {
    return NextResponse.json({ error: "not your project" }, { status: 403 });
  }
  const role: AdminRole = c.isSuper ? "admin" : "creator";

  // Operational/economic controls stay super-admin only.
  const superOnly = body.action === "set-key" || body.action === "pause" || body.action === "resume";
  if (superOnly && !c.isSuper) {
    return NextResponse.json({ error: "reserved for the platform admin" }, { status: 403 });
  }

  try {
    if (body.action === "edit") {
      await updateProjectFields(key, restrictPatchForRole(body.fields ?? {}, role));
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
