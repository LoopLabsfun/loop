import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder, adminWallet } from "@/lib/admin-guard";
import {
  listProjectDomains,
  attachProjectDomain,
  verifyProjectDomain,
  detachProjectDomain,
} from "@/lib/project-domain";

// CUSTOM DOMAIN management for a project's Vercel project. Same auth as the project
// editor: the LOOP super-admin or the project's own creator. Attaching a domain is a
// brand action (not economic/safety), so it's open to both roles.
//   GET ?key=…                      → live domains on the project + DNS to set
//   POST {key, action:"attach", domain} → add a custom domain (returns DNS records)
//   POST {key, action:"verify", domain} → re-check DNS; persists when verified
//   POST {key, action:"detach", domain} → remove it
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Authorize the caller against a target project key: LOOP super-admin or the
 *  project's own creator. Returns an error response when not allowed. */
async function authorize(req: Request, key: string) {
  const wallet = adminWallet(req);
  if (!wallet) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const target = await getProject(key);
  if (!target) return { error: NextResponse.json({ error: "project not found" }, { status: 404 }) };
  const loop = await getProject("loop");
  const isSuper = Boolean(loop && isFounder(req, loop));
  const isCreator = Boolean(target.creatorWallet && wallet === target.creatorWallet);
  if (!isSuper && !isCreator) {
    return { error: NextResponse.json({ error: "not your project" }, { status: 403 }) };
  }
  return { ok: true as const };
}

function validKey(key: string): boolean {
  return /^[a-z0-9-]{1,60}$/.test(key);
}

export async function GET(req: Request) {
  const key = (new URL(req.url).searchParams.get("key") || "").trim();
  if (!validKey(key)) return NextResponse.json({ error: "valid project key required" }, { status: 400 });
  const a = await authorize(req, key);
  if ("error" in a) return a.error;
  const res = await listProjectDomains(key);
  return NextResponse.json(res);
}

export async function POST(req: Request) {
  let body: { key?: string; action?: string; domain?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const key = (body.key || "").trim();
  if (!validKey(key)) return NextResponse.json({ error: "valid project key required" }, { status: 400 });
  const a = await authorize(req, key);
  if ("error" in a) return a.error;

  const domain = String(body.domain ?? "");
  if (body.action === "attach") return NextResponse.json(await attachProjectDomain(key, domain));
  if (body.action === "verify") return NextResponse.json(await verifyProjectDomain(key, domain));
  if (body.action === "detach") return NextResponse.json(await detachProjectDomain(key, domain));
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
