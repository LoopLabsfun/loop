import "server-only";
import {
  provisionPlan,
  githubConfigured,
  vercelConfigured,
  type ProvisionPlan,
} from "./provisioning";

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
 *  a repo that already exists is treated as success. Never throws. */
export async function createProjectRepo(plan: ProvisionPlan, description: string): Promise<RepoResult> {
  if (!githubConfigured()) return { ok: false, note: "GITHUB_TOKEN unset" };
  const [owner, name] = plan.repo.split("/");
  if (!owner || !name) return { ok: false, note: `bad repo slug ${plan.repo}` };
  try {
    const exists = await fetch(`${GH}/repos/${owner}/${name}`, { headers: ghHeaders(), cache: "no-store" });
    if (exists.ok) {
      const j = (await exists.json()) as { id: number; default_branch: string };
      return { ok: true, repoUrl: plan.repoUrl, repoId: j.id, defaultBranch: j.default_branch, note: "repo already exists" };
    }

    const desc = description.slice(0, 200);
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
      return { ok: true, repoUrl: plan.repoUrl, repoId: j.id, defaultBranch: j.default_branch, note: `created from template ${template}` };
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
    const j = (await r.json()) as { url?: string };
    return { ok: true, note: "first deploy triggered", url: j.url ? `https://${j.url}` : undefined };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "deploy trigger error" };
  }
}

/** Provision a launched project's white-label home (repo + Vercel project +
 *  its first deploy). Env-gated, best-effort, never throws — a failure leaves
 *  the project launched (the home can be (re-)provisioned later) rather than
 *  aborting the mint. */
export async function provisionProjectHome(
  key: string,
  description: string,
): Promise<{ repoOk: boolean; vercelOk: boolean; deployOk: boolean; repo: string; note: string }> {
  const plan = provisionPlan(key);
  if (!githubConfigured() && !vercelConfigured()) {
    return { repoOk: false, vercelOk: false, deployOk: false, repo: plan.repo, note: "provisioning unarmed (no GITHUB_TOKEN/VERCEL_TOKEN)" };
  }
  const repo = await createProjectRepo(plan, description);
  const vercel = await createVercelProject(plan);
  let deploy: { ok: boolean; note: string } = { ok: false, note: "skipped (repo or vercel project not ready)" };
  if (repo.ok && repo.repoId != null && vercel.ok) {
    deploy = await triggerFirstDeploy(plan, repo.repoId, repo.defaultBranch || "main");
  }
  return {
    repoOk: repo.ok,
    vercelOk: vercel.ok,
    deployOk: deploy.ok,
    repo: plan.repo,
    note: `repo: ${repo.note} · vercel: ${vercel.note} · deploy: ${deploy.note}`,
  };
}
