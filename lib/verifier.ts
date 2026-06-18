import type { Project } from "./types";
import type { TaskStatus } from "./agent";

// ─────────────────────────────────────────────────────────────────────────────
// VERIFIER GATE — the objective stop condition for a project's agent.
//
// The single most important guardrail for autonomous loops (see
// docs/loop-roadmap.md A1): work may only ship when an *objective* check can and
// did pass — a test/build/typecheck/lint signal — and when the actor that
// *verified* the work is not the same one that *produced* it (maker ≠ checker).
// This prevents the "Ralph Wiggum" failure (the agent declares done early, fails
// quietly, keeps spending) and self-preferential bias (the maker grading its own
// homework).
//
// Pure + testable. The runtime feeds real CI/sandbox results into `evaluateGate`
// and calls `canShip` before promoting a task/directive to shipped/applied.
// ─────────────────────────────────────────────────────────────────────────────

export type CheckKind = "test" | "build" | "typecheck" | "lint" | "custom";

/** One objective signal produced by running something that can fail. */
export interface VerifyCheck {
  kind: CheckKind;
  name: string; // e.g. "vitest", "tsc --noEmit", "next build"
  passed: boolean;
  detail?: string; // e.g. "80/80 passed" or a failing-output summary
}

export interface GateResult {
  /** True only when every required check is present AND passing. */
  passed: boolean;
  checks: VerifyCheck[];
  /** Required kinds with no check recorded — the agent would ship blind. */
  missing: CheckKind[];
  /** Recorded checks that failed. */
  failed: VerifyCheck[];
  summary: string;
}

/**
 * The objective signals required before this project's agent may ship. Mirrors
 * `defaultMandate`: the floor is a build + a typecheck (does it even compile?);
 * official / flagship projects must also pass tests and lint. The runtime can
 * override per project.
 */
export function defaultGate(p: Pick<Project, "official">): CheckKind[] {
  return p.official
    ? ["build", "typecheck", "test", "lint"]
    : ["build", "typecheck"];
}

/** Aggregate recorded checks against the required set into a single verdict. */
export function evaluateGate(
  checks: VerifyCheck[],
  required: CheckKind[]
): GateResult {
  const present = new Set(checks.map((c) => c.kind));
  const missing = required.filter((k) => !present.has(k));
  const failed = checks.filter((c) => !c.passed);
  // Pass requires: nothing required is missing, and no recorded check failed.
  const passed = missing.length === 0 && failed.length === 0;

  let summary: string;
  if (passed) {
    summary = `gate passed · ${checks.length} check${checks.length === 1 ? "" : "s"} green`;
  } else {
    const parts: string[] = [];
    if (failed.length) parts.push(`${failed.map((c) => c.name).join(", ")} failed`);
    if (missing.length) parts.push(`missing ${missing.join(", ")}`);
    summary = `gate failed · ${parts.join("; ")}`;
  }
  return { passed, checks, missing, failed, summary };
}

/**
 * Maker ≠ checker. The actor that produced the work must not be the actor that
 * verified it. Empty/whitespace ids count as unknown → not independent.
 */
export function isIndependentlyVerified(
  makerId: string | null | undefined,
  checkerId: string | null | undefined
): boolean {
  const m = (makerId ?? "").trim();
  const c = (checkerId ?? "").trim();
  return Boolean(m) && Boolean(c) && m !== c;
}

export interface ShipDecision {
  ok: boolean;
  reason: string;
}

/**
 * The guard the runtime calls before marking a task/directive shipped/applied.
 * Blocks unless the objective gate passed AND a distinct checker verified it.
 */
export function canShip(opts: {
  gate: GateResult;
  makerId: string | null | undefined;
  checkerId: string | null | undefined;
}): ShipDecision {
  if (!isIndependentlyVerified(opts.makerId, opts.checkerId)) {
    return {
      ok: false,
      reason: "blocked: work must be verified by a checker distinct from its maker",
    };
  }
  if (!opts.gate.passed) {
    return { ok: false, reason: `blocked: ${opts.gate.summary}` };
  }
  return { ok: true, reason: opts.gate.summary };
}

/**
 * Enforce the STANDING CI gate on an agent's self-reported task status: "shipped"
 * is only allowed when an independent checker recorded a passing `defaultGate`
 * (build/typecheck/test/lint for official projects). This is the stricter bar for
 * when a project's real repo CI is wired into the runtime. For what the live
 * runtime can actually run today — a per-cycle sandbox command — use
 * `gateAgentShip`, which gates against the kinds that actually ran this cycle.
 * Any non-"shipped" status passes through untouched.
 */
export function gateTaskStatus(opts: {
  project: Pick<Project, "official">;
  status: TaskStatus;
  makerId: string;
  checkerId?: string | null;
  checks?: VerifyCheck[];
}): { status: TaskStatus; note: string | null } {
  if (opts.status !== "shipped") return { status: opts.status, note: null };
  const gate = evaluateGate(opts.checks ?? [], defaultGate(opts.project));
  const decision = canShip({
    gate,
    makerId: opts.makerId,
    checkerId: opts.checkerId,
  });
  return decision.ok
    ? { status: "shipped", note: null }
    : { status: "building", note: decision.reason };
}

/** Heuristic: label a sandbox command by what it ran, for a richer build log. */
export function classifyCheck(code: string): CheckKind {
  const c = code.toLowerCase();
  // Order matters: a test runner often also builds, so match test first.
  if (/\b(pytest|vitest|jest|mocha|unittest|go test|cargo test)\b|npm (run )?test|\btests?\b/.test(c))
    return "test";
  if (/\btsc\b|--no-?emit|type-?check/.test(c)) return "typecheck";
  if (/\b(webpack|rollup)\b|next build|vite build|cargo build|npm run build|\bbuild\b|\bmake\b/.test(c))
    return "build";
  if (/\beslint\b|\bruff\b|\bflake8\b|prettier --check|\blint\b/.test(c)) return "lint";
  return "custom";
}

/**
 * Turn one real sandbox run into an objective `VerifyCheck`. The E2B sandbox is a
 * runner distinct from the maker agent, so a passing run is a legitimate
 * independent signal (maker ≠ checker). `passed` is the sandbox's own exit
 * verdict — the agent cannot fake it green.
 */
export function checkFromSandbox(
  cmd: { language: string; code: string },
  result: { ok: boolean; error?: string; stderr?: string }
): VerifyCheck {
  const passed = result.ok;
  return {
    kind: classifyCheck(cmd.code),
    name: `e2b:${cmd.language}`,
    passed,
    detail: passed
      ? `ran clean in the ${cmd.language} sandbox`
      : (result.error || result.stderr || "sandbox run failed").replace(/\s+/g, " ").trim().slice(0, 160),
  };
}

/**
 * The RUNTIME ship gate the live agent uses each cycle. The agent (maker) may
 * declare a task "shipped", but it only ships when an INDEPENDENT checker (the
 * sandbox runner, e.g. "verifier:e2b") actually ran ≥1 objective check this cycle
 * and every recorded check passed. Zero checks ⇒ the agent ran nothing that could
 * fail ⇒ held at "building" (the Ralph Wiggum guard). Required kinds are exactly
 * what ran, so a green run isn't blocked for "missing lint"; the standing
 * 4-kind bar lives in `gateTaskStatus` for when real repo CI is wired.
 */
export function gateAgentShip(opts: {
  status: TaskStatus;
  makerId: string;
  checkerId?: string | null;
  checks: VerifyCheck[];
}): { status: TaskStatus; note: string | null } {
  if (opts.status !== "shipped") return { status: opts.status, note: null };
  if (opts.checks.length === 0) {
    return {
      status: "building",
      note: "held: no objective check ran this cycle (nothing could fail)",
    };
  }
  const required = Array.from(new Set(opts.checks.map((c) => c.kind)));
  const gate = evaluateGate(opts.checks, required);
  const decision = canShip({
    gate,
    makerId: opts.makerId,
    checkerId: opts.checkerId,
  });
  return decision.ok
    ? { status: "shipped", note: null }
    : { status: "building", note: `held: ${decision.reason}` };
}
