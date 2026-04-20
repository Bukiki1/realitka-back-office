import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { TOOL_DEFINITIONS, runTool } from "@/lib/tools";
import { SYSTEM_PROMPT } from "@/lib/systemPrompt";
import {
  PROVIDERS,
  findModel,
  resolveAnthropicModelId,
  MODELS,
  AUTO_MODEL_ID,
  type Provider,
} from "@/lib/models";
import { routeAuto } from "@/lib/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_AGENT_ROUNDS = 8;

type ChatMessage = { role: "user" | "assistant"; content: string };
type ApiKeys = Partial<Record<Provider, string>>;

type EventPayload =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean; preview: string }
  | { type: "used_model"; model_id: string; provider: Provider; label: string }
  | { type: "done" }
  | { type: "error"; error: string };

type RequestBody = {
  messages: ChatMessage[];
  model?: string;
  apiKeys?: ApiKeys;
  systemPrompt?: string;
  allowedTools?: string[];
};

function readEnvLocal(key: string): string | null {
  try {
    const envPath = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(envPath)) return null;
    const contents = fs.readFileSync(envPath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`));
      if (m) {
        const val = m[1].replace(/^['"]|['"]$/g, "").trim();
        if (val) return val;
      }
    }
  } catch {}
  return null;
}

function resolveKey(provider: Provider, client: ApiKeys | undefined): string | null {
  const fromClient = client?.[provider]?.trim();
  if (fromClient) return fromClient;
  const envName = PROVIDERS[provider].envKey;
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return fromEnv;
  return readEnvLocal(envName);
}

function availableModelIds(apiKeys: ApiKeys | undefined): string[] {
  return MODELS.filter((m) => resolveKey(m.provider, apiKeys)).map((m) => m.id);
}

function sseLine(ev: EventPayload): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

function previewResult(data: unknown): string {
  try {
    const json = JSON.stringify(data);
    return json.length > 500 ? json.slice(0, 500) + "…" : json;
  } catch {
    return String(data).slice(0, 500);
  }
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const RATE_LIMIT_USER_MSG = "⏳ Příliš mnoho dotazů — zkuste to prosím za minutu.";

function isRateLimit(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as { status?: number; statusCode?: number; code?: string; message?: string; error?: { type?: string } };
  if (anyErr.status === 429 || anyErr.statusCode === 429) return true;
  if (anyErr.code === "rate_limit_error" || anyErr.error?.type === "rate_limit_error") return true;
  const msg = typeof anyErr.message === "string" ? anyErr.message.toLowerCase() : "";
  return msg.includes("429") || msg.includes("rate_limit") || msg.includes("rate limit");
}

async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  canRetry: () => boolean,
  maxRetries = 2,
  delayMs = 5000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimit(err) || attempt === maxRetries || !canRetry()) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Nevalidní JSON.");
  }

  const history = (body.messages ?? []).filter(
    (m): m is ChatMessage =>
      !!m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant")
  );
  if (history.length === 0) return jsonError(400, "Prázdná konverzace.");

  const apiKeys = body.apiKeys ?? {};
  const requestedModel = body.model || AUTO_MODEL_ID;
  const customSystemPrompt = body.systemPrompt?.trim() || null;
  const filterToolNames = Array.isArray(body.allowedTools) && body.allowedTools.length > 0
    ? new Set(body.allowedTools)
    : null;
  const effectiveTools = filterToolNames
    ? TOOL_DEFINITIONS.filter((t) => filterToolNames.has(t.name))
    : TOOL_DEFINITIONS;
  const effectiveSystem = customSystemPrompt || SYSTEM_PROMPT;

  // Auto-routing: zavoláme Haiku, vybere nejvhodnější dostupný model.
  let selectedId: string;
  if (requestedModel === AUTO_MODEL_ID) {
    const anthropicKey = resolveKey("anthropic", apiKeys);
    if (!anthropicKey) {
      return jsonError(
        400,
        "Auto routing potřebuje Anthropic klíč (Haiku router). Přidej klíč v /settings nebo .env.local."
      );
    }
    const available = availableModelIds(apiKeys);
    if (available.length === 0) {
      return jsonError(400, "Žádný model není dostupný. Nastav aspoň jeden klíč v /settings.");
    }
    const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
    try {
      const decision = await routeAuto(anthropicKey, lastUser, available);
      selectedId = decision.modelId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonError(500, `Router selhal: ${msg}`);
    }
  } else {
    selectedId = requestedModel;
  }

  const modelDef = findModel(selectedId);
  if (!modelDef) return jsonError(400, `Neznámý model: ${selectedId}`);
  if (modelDef.locked) return jsonError(400, `Model ${modelDef.label} zatím není podporovaný.`);

  const provider = modelDef.provider;
  const apiKey = resolveKey(provider, apiKeys);
  if (!apiKey) {
    return jsonError(
      400,
      `API klíč pro ${PROVIDERS[provider].label} není nastaven. Otevři /settings a vlož klíč.`
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (ev: EventPayload) => controller.enqueue(encoder.encode(sseLine(ev)));

      // Oznámíme klientovi, který model skutečně odpovídá (důležité pro Auto).
      send({
        type: "used_model",
        model_id: modelDef.id,
        provider,
        label: modelDef.label,
      });

      let streamedAny = false;
      const wrappedSend = (ev: EventPayload) => {
        if (ev.type === "text" && ev.text) streamedAny = true;
        send(ev);
      };
      try {
        await withRateLimitRetry(async () => {
          if (provider === "anthropic") {
            await runAnthropic({
              apiKey, model: modelDef.id, history, send: wrappedSend,
              system: effectiveSystem, tools: effectiveTools,
            });
          } else if (provider === "google") {
            await runGemini({ apiKey, model: modelDef.id, history, send: wrappedSend, system: effectiveSystem });
          } else {
            await runOpenAICompat({
              apiKey, provider, model: modelDef.id, history, send: wrappedSend,
              system: effectiveSystem, tools: effectiveTools,
            });
          }
        }, () => !streamedAny);
        send({ type: "done" });
      } catch (err) {
        const friendly = isRateLimit(err)
          ? RATE_LIMIT_USER_MSG
          : (err instanceof Error ? err.message : String(err));
        send({ type: "error", error: friendly });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// ───────────────────── Anthropic (plná tool-use smyčka) ─────────────────────

async function runAnthropic(opts: {
  apiKey: string;
  model: string;
  history: ChatMessage[];
  send: (ev: EventPayload) => void;
  system: string;
  tools: typeof TOOL_DEFINITIONS;
}) {
  const { apiKey, model, history, send, system, tools } = opts;
  const client = new Anthropic({ apiKey });
  const resolved = resolveAnthropicModelId(model);

  const anthropicMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    const msgStream = client.messages.stream({
      model: resolved,
      max_tokens: 4096,
      system,
      tools,
      messages: anthropicMessages,
    });
    msgStream.on("text", (delta) => {
      if (delta) send({ type: "text", text: delta });
    });
    const finalMsg = await msgStream.finalMessage();
    anthropicMessages.push({ role: "assistant", content: finalMsg.content });

    if (finalMsg.stop_reason !== "tool_use") return;

    const toolUses = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      send({ type: "tool_use", name: tu.name, input: tu.input });
      const result = await runTool(tu.name, (tu.input as Record<string, unknown>) ?? {});
      const resultContent = result.ok
        ? JSON.stringify(result.data)
        : JSON.stringify({ error: result.error });
      send({
        type: "tool_result",
        name: tu.name,
        ok: result.ok,
        preview: previewResult(result.ok ? result.data : { error: result.error }),
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: resultContent,
        is_error: !result.ok,
      });
    }
    anthropicMessages.push({ role: "user", content: toolResults });
  }
  throw new Error("Agent přesáhl maximální počet kol.");
}

// ──────── OpenAI-compatible (OpenAI, xAI, Mistral, DeepSeek, Together) ────────

type OAIAsstMsg = {
  role: "assistant";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};
type OAIToolMsg = { role: "tool"; tool_call_id: string; content: string };
type OAISystemMsg = { role: "system"; content: string };
type OAIUserMsg = { role: "user"; content: string };
type OAIMessage = OAISystemMsg | OAIUserMsg | OAIAsstMsg | OAIToolMsg;

type OAIToolCallAccum = { id: string; name: string; argsBuffer: string };

async function runOpenAICompat(opts: {
  apiKey: string;
  provider: Provider;
  model: string;
  history: ChatMessage[];
  send: (ev: EventPayload) => void;
  system: string;
  tools: typeof TOOL_DEFINITIONS;
}) {
  const { apiKey, provider, model, history, send, system, tools: toolDefs } = opts;
  const endpoint = PROVIDERS[provider].endpoint;

  const tools = toolDefs.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const messages: OAIMessage[] = [
    { role: "system", content: system },
    ...history.map(
      (m): OAIMessage => ({ role: m.role, content: m.content })
    ),
  ];

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, stream: true, messages, tools }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText);
      const e = new Error(`${PROVIDERS[provider].label}: ${res.status} ${errText.slice(0, 300)}`) as Error & { status?: number };
      e.status = res.status;
      throw e;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let assistantContent = "";
    const toolCalls: OAIToolCallAccum[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload);
          const choice = obj.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta ?? {};
          if (typeof delta.content === "string" && delta.content) {
            assistantContent += delta.content;
            send({ type: "text", text: delta.content });
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0;
              toolCalls[i] ??= { id: "", name: "", argsBuffer: "" };
              if (tc.id) toolCalls[i].id = tc.id;
              if (tc.function?.name) toolCalls[i].name = tc.function.name;
              if (typeof tc.function?.arguments === "string") {
                toolCalls[i].argsBuffer += tc.function.arguments;
              }
            }
          }
        } catch {}
      }
    }

    const validTools = toolCalls.filter((tc) => tc.name);
    if (validTools.length === 0) return;

    messages.push({
      role: "assistant",
      content: assistantContent || null,
      tool_calls: validTools.map((tc) => ({
        id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        type: "function",
        function: { name: tc.name, arguments: tc.argsBuffer || "{}" },
      })),
    });

    for (const tc of validTools) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.argsBuffer || "{}");
      } catch {}
      send({ type: "tool_use", name: tc.name, input });
      const result = await runTool(tc.name, input);
      const content = result.ok
        ? JSON.stringify(result.data)
        : JSON.stringify({ error: result.error });
      send({
        type: "tool_result",
        name: tc.name,
        ok: result.ok,
        preview: previewResult(result.ok ? result.data : { error: result.error }),
      });
      messages.push({
        role: "tool",
        tool_call_id: tc.id || messages.length.toString(),
        content,
      });
    }
  }
  throw new Error("Agent přesáhl maximální počet kol.");
}

// ───────────────────── Google Gemini (text-only streaming) ─────────────────────

async function runGemini(opts: {
  apiKey: string;
  model: string;
  history: ChatMessage[];
  send: (ev: EventPayload) => void;
  system: string;
}) {
  const { apiKey, model, history, send, system } = opts;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    }),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    const e = new Error(`Google: ${res.status} ${errText.slice(0, 300)}`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const obj = JSON.parse(payload);
        const parts = obj.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (typeof p.text === "string" && p.text) send({ type: "text", text: p.text });
          }
        }
      } catch {}
    }
  }
}
