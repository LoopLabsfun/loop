// Agent-readiness score for a new project (docs/loop-roadmap.md A2).
//
// Be honest at launch: most ideas don't need an autonomous loop yet. Score the
// founder's launch inputs against the loop-engineering "4 conditions" and steer
// them toward agent-suitable scopes (a real repo with tests) over judgment-call
// work — protecting the platform's cost-per-accepted-change.
//
// Pure + testable: fast heuristics over the founder's own inputs (prompt, repo),
// no network/LLM, so the badge updates live as they type. It guides, it doesn't
// block — a low score still launches.

export type ReadinessLevel = "strong" | "workable" | "early";

export type ConditionKey = "repeatable" | "verifiable" | "tooling" | "budget";

export interface ReadinessCondition {
  key: ConditionKey;
  label: string;
  met: boolean;
  hint: string;
}

export interface Readiness {
  score: number; // 0..4
  level: ReadinessLevel;
  conditions: ReadinessCondition[];
  headline: string;
  /** The single most useful next step to raise the score (or "" when strong). */
  guidance: string;
}

const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+/i;
// Concrete "build software" verbs ⇒ repeatable, agent-suitable work.
const BUILD_RE =
  /\b(build|ship|add|implement|fix|refactor|automate|integrate|deploy|code|feature|api|app|site|bot|cli|library|dashboard|test)\w*/i;
// Signals an objective gate exists / is wanted.
const VERIFY_RE = /\b(test|tests|ci|typecheck|lint|spec|coverage|e2e|unit)\w*/i;

export function hasRepo(repo: string | undefined): boolean {
  return GITHUB_RE.test((repo ?? "").trim());
}

/** Score the launch inputs. `budget` is structurally met on Loop (market-funded). */
export function scoreReadiness(input: {
  prompt?: string;
  repo?: string;
}): Readiness {
  const prompt = (input.prompt ?? "").trim();
  const repo = hasRepo(input.repo);
  const specific = prompt.length >= 40; // enough detail to act on

  const repeatable = BUILD_RE.test(prompt) && specific;
  const verifiable = VERIFY_RE.test(prompt) || repo; // repo can carry tests
  const tooling = repo;
  const budget = true; // treasury funds it once the market does

  const conditions: ReadinessCondition[] = [
    {
      key: "repeatable",
      label: "Repeatable build work",
      met: repeatable,
      hint: "Describe concrete software to build/ship — not a one-off judgment call.",
    },
    {
      key: "verifiable",
      label: "Objective verification",
      met: verifiable,
      hint: "Give the agent a way to be checked: tests/CI, or a repo that has them.",
    },
    {
      key: "tooling",
      label: "Real codebase",
      met: tooling,
      hint: "Add a GitHub repo so the agent has senior-engineer tooling to work in.",
    },
    {
      key: "budget",
      label: "Market-funded budget",
      met: budget,
      hint: "Trading fees fund the agent — it works while the treasury is funded.",
    },
  ];

  const score = conditions.filter((c) => c.met).length;
  const level: ReadinessLevel = score >= 3 ? "strong" : score === 2 ? "workable" : "early";

  const headline =
    level === "strong"
      ? "Strong agent fit"
      : level === "workable"
        ? "Workable — can be improved"
        : "Not very agent-ready yet";

  const firstUnmet = conditions.find((c) => !c.met);
  const guidance = level === "strong" ? "" : firstUnmet?.hint ?? "";

  return { score, level, conditions, headline, guidance };
}
