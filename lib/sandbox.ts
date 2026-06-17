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
  language: SandboxLanguage = "python"
): Promise<SandboxResult> {
  if (!sandboxConfigured()) {
    throw new Error("Sandbox requested but E2B_API_KEY is not set.");
  }
  const { Sandbox } = await import("@e2b/code-interpreter");
  const sbx = await Sandbox.create();
  try {
    const exec = await sbx.runCode(code, { language });
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
