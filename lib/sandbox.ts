import "server-only";

// The agent's "hands": run real code in an isolated E2B sandbox. The brain
// (lib/agent-runtime) may emit a `command`; this executes it and returns the
// output to fold back into the build log. Env-gated on E2B_API_KEY — without it
// the agent simply plans without executing. Heavy SDK imported dynamically;
// server-only so the key never reaches the browser.

export type SandboxLanguage = "python" | "javascript" | "bash";

export interface SandboxResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export function sandboxConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY);
}

/**
 * The custom **warm** E2B template to spawn (built by `scripts/e2b-template.ts`:
 * code-interpreter base + git + a pre-warmed npm cache from this repo's
 * lockfile). When set, the per-cycle repo-hands gate (clone → npm ci → tsc →
 * tests) hits the cache instead of cold-installing on E2B's base image — which is
 * what makes it fit the cron time budget. Unset ⇒ E2B's default base.
 */
export function sandboxTemplate(): string | undefined {
  return process.env.E2B_TEMPLATE?.trim() || undefined;
}

/**
 * Strip terminal noise so summaries read clean when broadcast (Telegram, posts):
 * ANSI/CSI escape sequences (colors, cursor moves like `ESC[1G`), progress-spinner
 * braille glyphs, and other C0 control chars.
 */
export function stripTerminalNoise(s: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
      .replace(/[⠀-⣿]/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
  );
}

/** Pure: collapse a sandbox result into a short line for the build log. */
export function summarizeSandbox(r: SandboxResult, max = 280): string {
  const body = r.ok
    ? r.stdout.trim() || "(no output)"
    : `error: ${r.error || r.stderr.trim() || "failed"}`;
  const oneLine = stripTerminalNoise(body).replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

export async function runInSandbox(
  code: string,
  language: SandboxLanguage = "python",
  /** Env vars injected into the sandbox (e.g. GITHUB_TOKEN for repo-hands). Kept
   *  out of `code` so the script string stays safe to log/persist. */
  envs?: Record<string, string>,
  /** Execution budget. E2B's `runCode` default is ~60s — far too short for the
   *  repo-hands gate (clone → npm ci → tsc → vitest), which silently timed out
   *  and so never pushed. Set this generously for repo-hands; keep the sandbox
   *  lifetime ≥ it so the box isn't reaped mid-run. */
  opts?: { timeoutMs?: number }
): Promise<SandboxResult> {
  if (!sandboxConfigured()) {
    throw new Error("Sandbox requested but E2B_API_KEY is not set.");
  }
  const { Sandbox } = await import("@e2b/code-interpreter");
  const timeoutMs = opts?.timeoutMs;
  const createOpts = {
    ...(envs ? { envs } : {}),
    // Sandbox lifetime must outlast the run, or E2B reaps it mid-gate.
    ...(timeoutMs ? { timeoutMs: timeoutMs + 30_000 } : {}),
  };
  // Spawn the warm custom template when provisioned (E2B_TEMPLATE); otherwise
  // E2B's default base. The template carries git + a pre-warmed npm cache so the
  // repo-hands gate fits the cron budget instead of cold-installing every cycle.
  const template = sandboxTemplate();
  const sbx = template
    ? await Sandbox.create(template, createOpts)
    : await Sandbox.create(createOpts);
  try {
    const exec = await sbx.runCode(code, {
      language,
      envs,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    return {
      ok: !exec.error,
      stdout: (exec.logs?.stdout ?? []).join("\n"),
      stderr: (exec.logs?.stderr ?? []).join("\n"),
      error: exec.error?.value,
    };
  } finally {
    await sbx.kill();
  }
}
