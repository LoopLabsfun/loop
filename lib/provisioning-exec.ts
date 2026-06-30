import "server-only";
import {
  provisionPlan,
  githubConfigured,
  vercelConfigured,
  type ProvisionPlan,
} from "./provisioning";
import { brandedLayoutJsx, brandedPageJsx, isGenericTemplateContent, type ProjectBrand } from "./project-template-brand";

// ─────────────────────────────────────────────────────────────────────────────
// PROVISIONING — EXECUTION. lib/provisioning PLANS the white-label home
// (LoopLabsfun/<slug> + the Vercel project); this CREATES it on-chain-of-launch so
// a new project's agent has a real repo to build in and a Vercel project to deploy.
//
// Env-gated + best-effort + idempotent (same posture as the launchpad providers):
// no GITHUB_TOKEN ⇒ no-op, so Approve works exactly as before until armed. The repo
// is created from a TEMPLATE (GITHUB_TEMPLATE_REPO, e.g. LoopLabsfun/project-template
// — a minimal buildable Next starter the founder creates once) so the first agent
// build is green; falls back to an empty repo when no template is set.
// ─────────────────────────────────────────────────────────────────────────────

const GH = "https://api.github.com";

function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Create-or-update a file via the GitHub Contents API (PUT requires the
 *  current blob's sha to update; omitted for a brand-new file). Never throws. */
async function putFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
): Promise<{ ok: boolean; note: string }> {
  try {
    const getR = await fetch(`${GH}/repos/${owner}/${repo}/contents/${path}`, { headers: ghHeaders(), cache: "no-store" });
    const sha = getR.ok ? ((await getR.json()) as { sha?: string }).sha : undefined;
    const r = await fetch(`${GH}/repos/${owner}/${repo}/contents/${path}`, {
      method: "PUT",
      headers: ghHeaders(),
      cache: "no-store",
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        sha,
      }),
    });
    if (!r.ok) return { ok: false, note: `PUT ${path} failed (${r.status}): ${(await r.text()).slice(0, 160)}` };
    return { ok: true, note: `updated ${path}` };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : `PUT ${path} error` };
  }
}

/** Swap the bare template's placeholder pages for the project's real identity
 *  (name, ticker, description, token image) in Loop's own look — committed
 *  right after the repo is generated, BEFORE the agent's first commit or the
 *  first Vercel deploy, so the very first thing anyone sees is branded, not a
 *  generic "🚀 Building autonomously on Loop" starter. Only ever called on a
 *  FRESHLY generated repo (never on an "already exists" repo, which may already
 *  hold real agent work this must not clobber). GitHub's template-generate can
 *  take a few seconds to finish copying content, so this retries briefly before
 *  giving up. Best-effort + never throws — a failure just leaves the generic
 *  template in place. */
export async function applyTemplateBranding(plan: ProvisionPlan, brand: ProjectBrand): Promise<{ ok: boolean; note: string }> {
  if (!githubConfigured()) return { ok: false, note: "GITHUB_TOKEN unset" };
  const [owner, name] = plan.repo.split("/");
  if (!owner || !name) return { ok: false, note: `bad repo slug ${plan.repo}` };
  for (let attempt = 0; ; attempt++) {
    const check = await fetch(`${GH}/repos/${owner}/${name}/contents/app/page.jsx`, { headers: ghHeaders(), cache: "no-store" });
    if (check.ok) break;
    if (attempt >= 4) return { ok: false, note: "template content never appeared (app/page.jsx missing)" };
    await sleep(2000);
  }
  const layout = await putFile(owner, name, "app/layout.jsx", brandedLayoutJsx(brand), "brand: project identity (Loop provisioning)");
  const page = await putFile(owner, name, "app/page.jsx", brandedPageJsx(brand), "brand: project identity (Loop provisioning)");
  return { ok: layout.ok && page.ok, note: `layout: ${layout.note} · page: ${page.note}` };
}

/** Pure: the Vercel "create project" body (framework + git link to the repo). */
export function vercelProjectPayload(plan: ProvisionPlan): Record<string, unknown> {
  return {
    name: plan.vercelProject,
    framework: "nextjs",
    gitRepository: { type: "github", repo: plan.repo },
  };
}

interface RepoResult {
  ok: boolean;
  repoUrl?: string;
  /** Numeric GitHub repo id + default branch — needed to trigger the first Vercel
   *  deploy from existing content (linking a repo doesn't itself build anything;
   *  only a NEW push after the link does, via the webhook). */
  repoId?: number;
  defaultBranch?: string;
  note: string;
}

/** Create the project's GitHub repo (from the template, else empty). Idempotent:
 *  a repo that already exists is treated as success. On a FRESH template-
 *  generated repo, also commits the project's branded landing page before
 *  returning (see applyTemplateBranding). An EXISTING repo gets the same
 *  branding retroactively, but ONLY if its app/page.jsx still IS the generic
 *  template's placeholder (isGenericTemplateContent) — this is what makes the
 *  admin "Re-provision" retry able to fix a repo that was created before this
 *  branding step existed, while still never touching a repo the agent has
 *  already started real work in. Never throws. */
export async function createProjectRepo(plan: ProvisionPlan, brand: ProjectBrand): Promise<RepoResult> {
  if (!githubConfigured()) return { ok: false, note: "GITHUB_TOKEN unset" };
  const [owner, name] = plan.repo.split("/");
  if (!owner || !name) return { ok: false, note: `bad repo slug ${plan.repo}` };
  try {
    const exists = await fetch(`${GH}/repos/${owner}/${name}`, { headers: ghHeaders(), cache: "no-store" });
    if (exists.ok) {
      const j = (await exists.json()) as { id: number; default_branch: string };
      const base = { ok: true as const, repoUrl: plan.repoUrl, repoId: j.id, defaultBranch: j.default_branch };
      const pageR = await fetch(`${GH}/repos/${owner}/${name}/contents/app/page.jsx`, { headers: ghHeaders(), cache: "no-store" });
      if (!pageR.ok) return { ...base, note: "repo already exists" };
      const pageJ = (await pageR.json()) as { content?: string };
      const content = pageJ.content ? Buffer.from(pageJ.content, "base64").toString("utf8") : "";
      if (!isGenericTemplateContent(content)) return { ...base, note: "repo already exists" };
      const branding = await applyTemplateBranding(plan, brand);
      return { ...base, note: `repo already exists (was still generic) · branding: ${branding.note}` };
    }

    const desc = brand.description.slice(0, 200);
    const template = process.env.GITHUB_TEMPLATE_REPO?.trim();
    if (template) {
      const [tOwner, tName] = template.split("/");
      const r = await fetch(`${GH}/repos/${tOwner}/${tName}/generate`, {
        method: "POST",
        headers: ghHeaders(),
        cache: "no-store",
        body: JSON.stringify({ owner, name, description: desc, private: false }),
      });
      if (!r.ok) return { ok: false, note: `template generate failed (${r.status}): ${(await r.text()).slice(0, 160)}` };
      const j = (await r.json()) as { id: number; default_branch: string };
      const branding = await applyTemplateBranding(plan, brand);
      return {
        ok: true,
        repoUrl: plan.repoUrl,
        repoId: j.id,
        defaultBranch: j.default_branch,
        note: `created from template ${template} · branding: ${branding.note}`,
      };
    }

    // No template → an empty (auto-init) repo. The agent scaffolds it; the first
    // gate build may fail until it does, so a template is strongly preferred.
    const r = await fetch(`${GH}/orgs/${owner}/repos`, {
      method: "POST",
      headers: ghHeaders(),
      cache: "no-store",
      body: JSON.stringify({ name, description: desc, private: false, auto_init: true }),
    });
    if (!r.ok) return { ok: false, note: `repo create failed (${r.status}): ${(await r.text()).slice(0, 160)}` };
    const j = (await r.json()) as { id: number; default_branch: string };
    return {
      ok: true,
      repoUrl: plan.repoUrl,
      repoId: j.id,
      defaultBranch: j.default_branch,
      note: "created empty repo (set GITHUB_TEMPLATE_REPO for a buildable starter)",
    };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "repo create error" };
  }
}

/** Create the Vercel project linked to the repo. Idempotent (409 = exists). Never throws. */
export async function createVercelProject(plan: ProvisionPlan): Promise<{ ok: boolean; note: string }> {
  if (!vercelConfigured()) return { ok: false, note: "VERCEL_TOKEN/TEAM_ID unset" };
  try {
    const team = process.env.VERCEL_TEAM_ID as string;
    const r = await fetch(`https://api.vercel.com/v11/projects?teamId=${encodeURIComponent(team)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(vercelProjectPayload(plan)),
    });
    if (r.ok) return { ok: true, note: `vercel project ${plan.vercelProject} created` };
    if (r.status === 409) return { ok: true, note: "vercel project already exists" };
    return { ok: false, note: `vercel create failed (${r.status}): ${(await r.text()).slice(0, 160)}` };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "vercel create error" };
  }
}

/** Poll a deployment until it's READY (or errors/times out), then resolve its
 *  REAL public URL. `plan.vercelUrl` (`<name>.vercel.app`) is just a guess — that
 *  exact subdomain lives in a GLOBAL namespace across every Vercel user and is
 *  essentially always already taken, so Vercel actually assigns a randomized
 *  alias instead (e.g. `forge-pearl.vercel.app`, confirmed live: every other
 *  Loop project got one of these, never the bare guessed name). Prefers the
 *  short production alias (`GET /v2/deployments/{id}/aliases`); falls back to
 *  the deployment's own URL — uglier, but always real — if alias lookup fails or
 *  hasn't propagated yet. Never throws. */
export async function resolveDeploymentUrl(
  deploymentId: string,
  timeoutMs = 180_000,
  intervalMs = 4_000,
): Promise<{ ok: boolean; note: string; url?: string }> {
  if (!vercelConfigured()) return { ok: false, note: "VERCEL_TOKEN/TEAM_ID unset" };
  const team = process.env.VERCEL_TEAM_ID as string;
  const headers = { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` };
  const deadline = Date.now() + timeoutMs;
  let lastUrl: string | undefined;
  try {
    while (Date.now() < deadline) {
      const r = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}?teamId=${encodeURIComponent(team)}`, {
        headers,
        cache: "no-store",
      });
      if (!r.ok) return { ok: false, note: `deployment status check failed (${r.status})`, url: lastUrl };
      const j = (await r.json()) as { readyState?: string; url?: string };
      if (j.url) lastUrl = `https://${j.url}`;
      if (j.readyState === "READY") {
        try {
          const ar = await fetch(`https://api.vercel.com/v2/deployments/${deploymentId}/aliases?teamId=${encodeURIComponent(team)}`, {
            headers,
            cache: "no-store",
          });
          if (ar.ok) {
            const aj = (await ar.json()) as { aliases?: { alias: string }[] };
            const alias = aj.aliases?.find((a) => a.alias.endsWith(".vercel.app"))?.alias ?? aj.aliases?.[0]?.alias;
            if (alias) return { ok: true, note: "deployment ready", url: `https://${alias}` };
          }
        } catch {
          /* fall through to the deployment's own URL below */
        }
        return { ok: true, note: "deployment ready (no short alias found)", url: lastUrl };
      }
      if (j.readyState === "ERROR" || j.readyState === "CANCELED") {
        return { ok: false, note: `deployment ${j.readyState.toLowerCase()}`, url: lastUrl };
      }
      await sleep(intervalMs);
    }
    return { ok: false, note: "deployment still building after timeout", url: lastUrl };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "deployment status error", url: lastUrl };
  }
}

/** Trigger the FIRST (or a fresh) Vercel deployment from the repo's current HEAD.
 *  Linking a git repo to a Vercel project (createVercelProject) does NOT itself
 *  build anything — Vercel only auto-deploys on a NEW push after the link, via
 *  the webhook it installs. A template-generated repo's existing commit never
 *  fires that webhook, so without this step the project sits live-but-empty
 *  forever. Idempotent to call again (just produces another deployment of the
 *  same HEAD). Never throws. */
export async function triggerFirstDeploy(
  plan: ProvisionPlan,
  repoId: number,
  ref = "main",
): Promise<{ ok: boolean; note: string; url?: string }> {
  if (!vercelConfigured()) return { ok: false, note: "VERCEL_TOKEN/TEAM_ID unset" };
  try {
    const team = process.env.VERCEL_TEAM_ID as string;
    const r = await fetch(`https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(team)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        name: plan.vercelProject,
        project: plan.vercelProject,
        target: "production",
        gitSource: { type: "github", repoId, ref },
      }),
    });
    if (!r.ok) return { ok: false, note: `deploy trigger failed (${r.status}): ${(await r.text()).slice(0, 160)}` };
    const j = (await r.json()) as { id?: string; uid?: string; url?: string };
    const deploymentId = j.id ?? j.uid;
    if (!deploymentId) return { ok: true, note: "deploy triggered (no id returned)", url: j.url ? `https://${j.url}` : undefined };
    // Wait for the build + alias so we return a URL that's actually live, not a
    // guess — this is the URL that ends up on the pump.fun token at mint.
    const resolved = await resolveDeploymentUrl(deploymentId);
    return { ok: resolved.ok, note: `deploy triggered · ${resolved.note}`, url: resolved.url };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "deploy trigger error" };
  }
}

/** Provision a launched project's white-label home (branded repo + Vercel
 *  project + its first deploy). Env-gated, best-effort, never throws — a
 *  failure leaves the project launched (the home can be (re-)provisioned
 *  later) rather than aborting the mint. */
export async function provisionProjectHome(
  key: string,
  brand: Omit<ProjectBrand, "key">,
): Promise<{ repoOk: boolean; vercelOk: boolean; deployOk: boolean; repo: string; vercelUrl?: string; note: string }> {
  const plan = provisionPlan(key);
  if (!githubConfigured() && !vercelConfigured()) {
    return { repoOk: false, vercelOk: false, deployOk: false, repo: plan.repo, note: "provisioning unarmed (no GITHUB_TOKEN/VERCEL_TOKEN)" };
  }
  const repo = await createProjectRepo(plan, { ...brand, key });
  const vercel = await createVercelProject(plan);
  let deploy: { ok: boolean; note: string; url?: string } = { ok: false, note: "skipped (repo or vercel project not ready)" };
  if (repo.ok && repo.repoId != null && vercel.ok) {
    deploy = await triggerFirstDeploy(plan, repo.repoId, repo.defaultBranch || "main");
  }
  return {
    repoOk: repo.ok,
    vercelOk: vercel.ok,
    deployOk: deploy.ok,
    repo: plan.repo,
    vercelUrl: deploy.url,
    note: `repo: ${repo.note} · vercel: ${vercel.note} · deploy: ${deploy.note}`,
  };
}
