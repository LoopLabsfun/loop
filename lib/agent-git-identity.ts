/**
 * The git author identity the agent commits under.
 *
 * Vercel BLOCKS production deployments whose commit-author email it can't
 * resolve to an authorized GitHub/team member. The agent has no GitHub account
 * and isn't in the org, so commits authored as `loop-agent <agent@looplabs.fun>`
 * produced an unresolvable author → every agent-authored deploy sat in state
 * BLOCKED and never went live (while org-member merges deployed fine).
 *
 * Fix: author commits under the **Loop Labs** GitHub identity, which IS a member
 * of the LoopLabsfun org. The default email below is the `looplabs-fun` account's
 * GitHub no-reply address (id 294296517) — it resolves to that org member, so
 * Vercel authorizes the deploy. The visible NAME stays "loop-agent" so the author
 * is still attributed to the agent in `git log`; a `Co-Authored-By` trailer keeps
 * the agent's handle credited. (Never use a personal/founder identity here.)
 *
 * Per-project / future agents: override via `AGENT_GIT_AUTHOR_NAME` /
 * `AGENT_GIT_AUTHOR_EMAIL` once an agent has its own GitHub identity in the org.
 */
export interface AgentGitIdentity {
  name: string;
  email: string;
}

/** Default author identity: the Loop Labs org member (resolvable → deploy authorized). */
export const DEFAULT_AGENT_GIT_NAME = "loop-agent";
export const DEFAULT_AGENT_GIT_EMAIL = "294296517+looplabs-fun@users.noreply.github.com";

export function agentGitIdentity(
  env: Record<string, string | undefined> = process.env,
): AgentGitIdentity {
  return {
    name: env.AGENT_GIT_AUTHOR_NAME?.trim() || DEFAULT_AGENT_GIT_NAME,
    email: env.AGENT_GIT_AUTHOR_EMAIL?.trim() || DEFAULT_AGENT_GIT_EMAIL,
  };
}
