import "server-only";
import type { Project } from "./types";
import { provisionPlan, githubConfigured, vercelConfigured } from "./provisioning";
import { buildPathReadiness } from "./agent-session-enqueue";
import { getAgentWallet, agentWalletConfigured } from "./agent-wallet";
import { supabaseAdmin } from "./supabase";

// LOT 4 — per-project provisioning checklist. A read-only, green/red view of the
// infrastructure bricks a launched project needs to actually run (repo, Vercel,
// wallets, mint, brain, build path, social-warm-up gate). Some bricks carry a
// `action` the founder can retry from the cockpit (create the repo/Vercel home,
// provision the agent wallet) — pure infra, no money moves. `unarmed` means the
// platform credential for that brick isn't set, so it can't even be checked.

export type BrickStatus = "ok" | "missing" | "unarmed";

export interface Brick {
  key: string;
  label: string;
  status: BrickStatus;
  detail: string;
  /** A retry the founder can trigger from the cockpit (infra create, no funds). */
  action?: "provision-home" | "provision-wallet" | "configure-fee-sharing";
}

export interface ProvisioningChecklist {
  repo: string;
  bricks: Brick[];
  /** True when every armed brick is ok (unarmed bricks don't block readiness). */
  ready: boolean;
}

/**
 * Pure: map a tri-state existence read to a brick status. `null` = the platform
 * credential for the brick is unset (couldn't check) → unarmed; `true` → ok;
 * `false` → missing. Keeps the unarmed/ok/missing meaning in one tested place.
 */
export function triStatus(value: boolean | null): BrickStatus {
  return value === null ? "unarmed" : value ? "ok" : "missing";
}

/** Pure: a checklist is ready when no brick is outright missing (unarmed is ok). */
export function checklistReady(bricks: Pick<Brick, "status">[]): boolean {
  return bricks.every((b) => b.status !== "missing");
}

/** Read-only GitHub repo existence check (HEAD on the repo). */
async function repoExists(repo: string): Promise<boolean | null> {
  if (!githubConfigured()) return null;
  const [owner, name] = repo.split("/");
  if (!owner || !name) return false;
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return null;
  }
}

/** Read-only Vercel project existence check. */
async function vercelExists(name: string): Promise<boolean | null> {
  if (!vercelConfigured()) return null;
  try {
    const team = process.env.VERCEL_TEAM_ID as string;
    const r = await fetch(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(name)}?teamId=${encodeURIComponent(team)}`,
      { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }, cache: "no-store" }
    );
    return r.ok;
  } catch {
    return null;
  }
}

/** Build the per-project provisioning checklist (read-only). */
export async function getProvisioningChecklist(p: Project): Promise<ProvisioningChecklist> {
  const plan = provisionPlan(p.key);
  const bricks: Brick[] = [];

  // 1. GitHub repo (the agent's hands need somewhere to push).
  const repo = await repoExists(plan.repo);
  bricks.push({
    key: "repo",
    label: "GitHub repo",
    status: triStatus(repo),
    detail: repo === null ? "GITHUB_TOKEN unset — can't check/create" : plan.repo,
    action: repo === false ? "provision-home" : undefined,
  });

  // 2. Vercel project (where deploys land).
  const vercel = await vercelExists(plan.vercelProject);
  bricks.push({
    key: "vercel",
    label: "Vercel project",
    status: triStatus(vercel),
    detail: vercel === null ? "VERCEL_TOKEN/TEAM_ID unset — can't check/create" : plan.vercelProject,
    action: vercel === false ? "provision-home" : undefined,
  });

  // 3. Agent wallet (Privy custody — signs the agent's on-chain actions).
  let agentWallet: boolean | null = null;
  if (agentWalletConfigured()) {
    agentWallet = Boolean(await getAgentWallet(p.key).catch(() => null));
  }
  bricks.push({
    key: "agent-wallet",
    label: "Agent wallet",
    status: triStatus(agentWallet),
    detail: agentWallet === null ? "PRIVY_APP_ID/SECRET unset — can't provision" : agentWallet ? "provisioned" : "not provisioned",
    action: agentWallet === false ? "provision-wallet" : undefined,
  });

  // 4. Treasury wallet (data brick — set on the project row; funds the agent).
  bricks.push({
    key: "treasury",
    label: "Treasury wallet",
    status: p.treasuryWallet ? "ok" : "missing",
    detail: p.treasuryWallet ?? "not set on the project row",
  });

  // 5. Token mint (the project's SPL token).
  bricks.push({
    key: "mint",
    label: "Token mint",
    status: p.mint ? "ok" : "missing",
    detail: p.mint ?? "not minted",
  });

  // 6. Brain credential (BYO key or the global platform key).
  let hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!hasKey) {
    const { secretsConfigured, getProjectAnthropicKey } = await import("./project-secrets");
    if (secretsConfigured()) hasKey = Boolean(await getProjectAnthropicKey(p.key).catch(() => null));
  }
  bricks.push({
    key: "brain-key",
    label: "Brain API key",
    status: hasKey ? "ok" : "missing",
    detail: hasKey ? "available (BYO or platform)" : "no Anthropic key — agent can't think",
  });

  // 7. Build path (can a code task actually ship?).
  const bp = buildPathReadiness();
  bricks.push({
    key: "build-path",
    label: `Build path (${bp.mode})`,
    status: bp.canBuild ? "ok" : "missing",
    detail: bp.canBuild ? "can ship code" : `missing ${bp.missing.join(", ")}`,
  });

  // 8. Social warm-up gate (a plan row must exist before the agent may post).
  let socialPlan = false;
  const sb = supabaseAdmin;
  if (sb) {
    const { data } = await sb
      .from("agent_social_plan")
      .select("project_key")
      .eq("project_key", p.key)
      .maybeSingle();
    socialPlan = Boolean(data);
  }
  bricks.push({
    key: "social-plan",
    label: "Social warm-up plan",
    status: socialPlan ? "ok" : "missing",
    detail: socialPlan ? "authored" : "not authored — agent stays silent until it writes one",
  });

  // 9. Native fee-sharing (pump.fun's own on-chain 30/65/5 split, see
  // lib/pump-fee-sharing.ts) — opt-in, only actionable once the project has a
  // mint. "unarmed" when PUMP_FEE_SHARING isn't set, since there's nothing to
  // check or retry yet.
  const { pumpFeeSharingEnabled } = await import("./pump-fee-sharing");
  const feeSharingArmed = pumpFeeSharingEnabled();
  bricks.push({
    key: "fee-sharing",
    label: "Native fee-sharing",
    status: !feeSharingArmed ? "unarmed" : p.feeSharingConfiguredAt ? "ok" : "missing",
    detail: !feeSharingArmed
      ? "PUMP_FEE_SHARING unset — off-chain attribution path used instead"
      : p.feeSharingConfiguredAt
        ? `configured ${p.feeSharingConfiguredAt}`
        : p.mint
          ? "not configured — retry below (fails cleanly if this project is privy-creator mode)"
          : "not minted yet",
    action: feeSharingArmed && !p.feeSharingConfiguredAt && p.mint ? "configure-fee-sharing" : undefined,
  });

  const ready = checklistReady(bricks);
  return { repo: plan.repo, bricks, ready };
}
