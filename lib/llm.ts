import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// LLM ROUTER — provider-agnostic chat completion for the agent's "family B" calls.
//
// The agent makes two very different kinds of LLM call:
//   A) the coding HANDS (Claude Agent SDK in E2B) — deeply Claude-coupled, the
//      expensive part, NOT routed here;
//   B) short, stateless chat-completions — paid holder chat, community Q&A, and
//      social authoring. These are cheap, low-stakes, and tolerate a non-Claude
//      model very well — so they're the right place to cut the Anthropic bill.
//
// This module is the single seam those family-B callers go through. The default
// provider is Anthropic, so with no env set behavior is byte-identical to the
// previous direct `new Anthropic().messages.create(...)` calls. Set
// LLM_CHAT_PROVIDER=groq (+ GROQ_API_KEY) to route them to Groq's OpenAI-
// compatible API instead — fast and free/cheap. Per-project override is supported
// via the opts arg so a founder's own provider/key can be threaded in later
// without touching callers.
//
// Plain fetch for the Groq path (no new dependency, matching the codebase's
// "fetch the REST API directly" pattern). Failure-safe is the CALLER's job: this
// throws on a misconfigured/failed call exactly like the SDK did, and every
// caller already wraps the call in try/catch returning a quiet no-op.
// ─────────────────────────────────────────────────────────────────────────────

import type { TokenUsage } from "./anthropic-cost";

export type LlmProvider = "anthropic" | "groq";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  /** System prompt (grounding + hard rails). */
  system: string;
  /** The conversation turns (usually a single user message for these calls). */
  messages: LlmMessage[];
  /** Output cap. */
  maxTokens: number;
  /** Anthropic model id to use when the provider is Anthropic (e.g. chatModel()).
   *  Ignored for non-Anthropic providers, which pick their own default. */
  model?: string;
  /** Request structured JSON output against this schema (social/recap calls). */
  jsonSchema?: Record<string, unknown>;
}

export interface LlmResult {
  /** Concatenated text output. */
  text: string;
  /** Token usage in the Anthropic shape (so callers keep using tokensToUsd). */
  usage: TokenUsage;
  /** The model actually used — pass to tokensToUsd for honest costing. */
  model: string;
  /** Which provider served the call. */
  provider: LlmProvider;
}

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

/** The provider the family-B calls run on. Default Anthropic (unchanged path). */
export function chatProvider(
  env: Record<string, string | undefined> = process.env
): LlmProvider {
  return (env.LLM_CHAT_PROVIDER || "").trim().toLowerCase() === "groq"
    ? "groq"
    : "anthropic";
}

/** Groq chat model (open-weight). Override with GROQ_CHAT_MODEL. */
export function groqModel(
  env: Record<string, string | undefined> = process.env
): string {
  return env.GROQ_CHAT_MODEL?.trim() || DEFAULT_GROQ_MODEL;
}

/**
 * One chat completion, routed to the configured provider. Default Anthropic ⇒
 * byte-identical to the previous direct SDK call. Throws on a misconfigured or
 * failed call (callers handle that as a quiet no-op).
 */
export async function chatComplete(
  req: LlmRequest,
  opts: { provider?: LlmProvider; apiKey?: string } = {}
): Promise<LlmResult> {
  const provider = opts.provider ?? chatProvider();
  return provider === "groq"
    ? groqComplete(req, opts.apiKey)
    : anthropicComplete(req, opts.apiKey);
}

async function anthropicComplete(
  req: LlmRequest,
  apiKey?: string
): Promise<LlmResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  const model = req.model || DEFAULT_ANTHROPIC_MODEL;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
  };
  if (req.jsonSchema) {
    params.output_config = { format: { type: "json_schema", schema: req.jsonSchema } };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const create = (client.messages.create as any).bind(client.messages);
  const res = (await create(params)) as {
    content: Array<{ type: string; text?: string }>;
    usage?: TokenUsage;
  };
  const text = (res.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  return {
    text,
    usage: res.usage ?? { input_tokens: 0, output_tokens: 0 },
    model,
    provider: "anthropic",
  };
}

async function groqComplete(req: LlmRequest, apiKey?: string): Promise<LlmResult> {
  const key = (apiKey ?? process.env.GROQ_API_KEY)?.trim();
  if (!key) throw new Error("GROQ_API_KEY not set (LLM_CHAT_PROVIDER=groq).");
  const model = groqModel();
  // OpenAI chat shape: the system prompt is the first message.
  const messages = [
    { role: "system", content: req.system },
    ...req.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = { model, max_tokens: req.maxTokens, messages };
  // json_object is the broadly-supported cross-model structured mode; the prompts
  // already describe the exact JSON shape, so this is enough to keep them parseable.
  if (req.jsonSchema) body.response_format = { type: "json_object" };
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Groq chat failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  const usage: TokenUsage = {
    input_tokens: json.usage?.prompt_tokens ?? 0,
    output_tokens: json.usage?.completion_tokens ?? 0,
  };
  return { text, usage, model, provider: "groq" };
}
