import { NextResponse } from "next/server";
import { getProjects } from "@/lib/queries";
import { agentSlug } from "@/lib/agent";
import { supabaseAdmin } from "@/lib/supabase";
import { slugFromAgentAddress, inboundRow } from "@/lib/email-inbound";
import { secretsMatch } from "@/lib/api-auth";

// Inbound webhook for the agent mailbox: a real domain's email router
// (Cloudflare Email Routing / Resend inbound) maps each message received at
// `<slug>@agents.looplabs.fun` to the InboundPayload shape and POSTs it here. We
// resolve the project, then store the message in `agent_emails` (direction "in").
//
// Gated by a shared secret (the router's worker sends it) — same posture as the
// agent tick route. Service-role write, so it needs SUPABASE_SERVICE_ROLE_KEY.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.EMAIL_INBOUND_SECRET;
  if (!secret || !secretsMatch(req.headers.get("x-email-secret"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "inbound mail not configured (set SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 }
    );
  }

  let body: { to?: string; from?: string; subject?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const slug = slugFromAgentAddress(body?.to);
  if (!slug) {
    return NextResponse.json(
      { error: "recipient is not an agent address" },
      { status: 400 }
    );
  }

  // Resolve the slug to a real project (agentSlug is lossy vs key, so match it).
  const projects = await getProjects();
  const project = projects.find((p) => agentSlug(p) === slug);
  if (!project) {
    return NextResponse.json(
      { error: `no project for ${slug}@agents.looplabs.fun` },
      { status: 404 }
    );
  }

  const { error } = await supabaseAdmin
    .from("agent_emails")
    .insert(inboundRow(project.key, body));
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, project: project.key },
    { headers: { "Cache-Control": "no-store" } }
  );
}
