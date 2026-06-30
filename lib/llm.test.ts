import { describe, it, expect, vi, afterEach } from "vitest";
import { chatProvider, groqModel, chatComplete } from "./llm";
import { tokensToUsd } from "./anthropic-cost";

describe("chatProvider", () => {
  it("defaults to anthropic", () => {
    expect(chatProvider({})).toBe("anthropic");
    expect(chatProvider({ LLM_CHAT_PROVIDER: "" })).toBe("anthropic");
    expect(chatProvider({ LLM_CHAT_PROVIDER: "anthropic" })).toBe("anthropic");
  });
  it("selects groq when explicitly set (case/space-insensitive)", () => {
    expect(chatProvider({ LLM_CHAT_PROVIDER: "groq" })).toBe("groq");
    expect(chatProvider({ LLM_CHAT_PROVIDER: " GROQ " })).toBe("groq");
  });
  it("ignores unknown providers (falls back to anthropic)", () => {
    expect(chatProvider({ LLM_CHAT_PROVIDER: "openai" })).toBe("anthropic");
  });
});

describe("groqModel", () => {
  it("defaults to a Groq open-weight model", () => {
    expect(groqModel({})).toBe("llama-3.3-70b-versatile");
  });
  it("honors GROQ_CHAT_MODEL override", () => {
    expect(groqModel({ GROQ_CHAT_MODEL: "llama-3.1-8b-instant" })).toBe("llama-3.1-8b-instant");
  });
});

describe("tokensToUsd — non-Claude models are not billed", () => {
  it("returns 0 for a Groq model (not on Anthropic credit)", () => {
    expect(
      tokensToUsd({ input_tokens: 10_000, output_tokens: 10_000 }, "llama-3.3-70b-versatile")
    ).toBe(0);
  });
  it("still prices Claude models", () => {
    expect(
      tokensToUsd({ input_tokens: 1_000_000, output_tokens: 0 }, "claude-haiku-4-5-20251001")
    ).toBeCloseTo(1.0, 5);
  });
});

describe("chatComplete — groq path", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts the OpenAI shape and normalizes the response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello from groq" } }],
          usage: { prompt_tokens: 12, completion_tokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await chatComplete(
      {
        system: "be brief",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
        model: "claude-haiku-4-5-20251001", // ignored on the groq path
      },
      { provider: "groq", apiKey: "gsk_test" }
    );

    expect(res.provider).toBe("groq");
    expect(res.model).toBe("llama-3.3-70b-versatile");
    expect(res.text).toBe("hello from groq");
    expect(res.usage).toEqual({ input_tokens: 12, output_tokens: 7 });

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toContain("api.groq.com");
    const body = JSON.parse(call[1].body as string);
    expect(body.model).toBe("llama-3.3-70b-versatile");
    expect(body.messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("requests json_object mode when a jsonSchema is given", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: {} }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await chatComplete(
      { system: "s", messages: [{ role: "user", content: "u" }], maxTokens: 50, jsonSchema: { type: "object" } },
      { provider: "groq", apiKey: "gsk_test" }
    );
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("throws when groq is selected but no key is available", async () => {
    const prev = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    await expect(
      chatComplete(
        { system: "s", messages: [{ role: "user", content: "u" }], maxTokens: 50 },
        { provider: "groq" }
      )
    ).rejects.toThrow(/GROQ_API_KEY/);
    if (prev !== undefined) process.env.GROQ_API_KEY = prev;
  });
});
