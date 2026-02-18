import { OpenAI } from "openai";
import { GoogleGenAI } from "@google/genai";
import { LLM_MODELS, GEMINI_MODELS, CLAUDE_MODELS } from "../config/models";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("[LLM Client] OPENAI_API_KEY is not set");
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

let _gemini: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!_gemini) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("[LLM Client] GEMINI_API_KEY is not set");
    _gemini = new GoogleGenAI({ apiKey });
  }
  return _gemini;
}

let _claude: InstanceType<typeof import("@anthropic-ai/sdk").default> | null = null;
async function getClaude() {
  if (!_claude) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("[LLM Client] ANTHROPIC_API_KEY is not set");
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    _claude = new Anthropic({ apiKey });
  }
  return _claude;
}

const OPENAI_MODELS = new Set<string>(Object.values(LLM_MODELS));
const GEMINI_MODEL_SET = new Set<string>(Object.values(GEMINI_MODELS));
const CLAUDE_MODEL_SET = new Set<string>(Object.values(CLAUDE_MODELS));

type Provider = "openai" | "gemini" | "claude";

export function detectProvider(model: string): Provider {
  if (OPENAI_MODELS.has(model)) return "openai";
  if (GEMINI_MODEL_SET.has(model)) return "gemini";
  if (CLAUDE_MODEL_SET.has(model)) return "claude";
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  if (model.startsWith("gemini-")) return "gemini";
  if (model.startsWith("claude-")) return "claude";
  throw new Error(`[LLM Client] Unknown model "${model}" — cannot determine provider. Add it to the model registry in server/config/models.ts`);
}

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMRequestOptions = {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type LLMResponse = {
  text: string;
  provider: Provider;
  model: string;
};

export async function generateText(opts: LLMRequestOptions): Promise<LLMResponse> {
  const provider = detectProvider(opts.model);

  switch (provider) {
    case "openai":
      return callOpenAI(opts);
    case "gemini":
      return callGemini(opts);
    case "claude":
      return callClaude(opts);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`[LLM Client] Unhandled provider: ${_exhaustive}`);
    }
  }
}

async function callOpenAI(opts: LLMRequestOptions): Promise<LLMResponse> {
  const response = await getOpenAI().chat.completions.create({
    model: opts.model,
    messages: opts.messages,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
    ...(opts.maxTokens !== undefined && { max_tokens: opts.maxTokens }),
  });

  return {
    text: response.choices[0]?.message?.content || "",
    provider: "openai",
    model: opts.model,
  };
}

async function callGemini(opts: LLMRequestOptions): Promise<LLMResponse> {
  const systemParts = opts.messages
    .filter(m => m.role === "system")
    .map(m => m.content);

  const nonSystemMessages = opts.messages.filter(m => m.role !== "system");

  const contents = nonSystemMessages.map(m => ({
    role: m.role === "assistant" ? "model" as const : "user" as const,
    parts: [{ text: m.content }],
  }));

  const systemInstruction = systemParts.length > 0
    ? systemParts.join("\n\n")
    : undefined;

  const response = await getGemini().models.generateContent({
    model: opts.model,
    config: {
      ...(systemInstruction && { systemInstruction }),
      ...(opts.temperature !== undefined && { temperature: opts.temperature }),
      ...(opts.maxTokens !== undefined && { maxOutputTokens: opts.maxTokens }),
    },
    contents,
  });

  return {
    text: response.text || "",
    provider: "gemini",
    model: opts.model,
  };
}

async function callClaude(opts: LLMRequestOptions): Promise<LLMResponse> {
  const client = await getClaude();

  const systemContent = opts.messages
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n\n");

  const nonSystemMessages = opts.messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens || 4096,
    ...(systemContent && { system: systemContent }),
    messages: nonSystemMessages,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
  });

  const textBlock = response.content.find(b => b.type === "text");

  return {
    text: textBlock?.text || "",
    provider: "claude",
    model: opts.model,
  };
}
