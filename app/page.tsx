"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar, type Conversation } from "@/components/Sidebar";
import { ChatMessage, type MessagePart, type UIMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { QuickActions } from "@/components/QuickActions";
import { Dashboard } from "@/components/Dashboard";
import { MorningBriefing } from "@/components/MorningBriefing";
import { Logo } from "@/components/Logo";
import { ModelPicker } from "@/components/ModelPicker";
import {
  AUTO_MODEL_ID,
  DEFAULT_MODEL_ID,
  PROVIDERS,
  findModel,
  type Provider,
} from "@/lib/models";
import {
  loadAgents,
  loadActiveAgentId,
  saveActiveAgentId,
  findAgent,
  type Agent,
} from "@/lib/agents";
import {
  loadConversations, saveConversations,
  loadMessages, saveMessages, deleteConversationStorage,
} from "@/lib/storage";

const MODEL_STORAGE_KEY = "selected_model_id";

type ServerEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean; preview: string }
  | { type: "used_model"; model_id: string; provider: Provider; label: string }
  | { type: "done" }
  | { type: "error"; error: string };

function collectApiKeys(): Partial<Record<Provider, string>> {
  const out: Partial<Record<Provider, string>> = {};
  for (const p of Object.keys(PROVIDERS) as Provider[]) {
    const v = localStorage.getItem(PROVIDERS[p].storageKey);
    if (v && v.trim()) out[p] = v.trim();
  }
  return out;
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function firstLine(s: string, max = 60): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max) + "…" : line;
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [initStatus, setInitStatus] = useState<"idle" | "ready" | "error">("idle");
  const [dbMode, setDbMode] = useState<"prod" | "test">("prod");
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [unlockedProviders, setUnlockedProviders] = useState<Set<Provider>>(new Set(["anthropic"]));
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentIdState] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Inicializace DB (seed při prvním běhu).
  useEffect(() => {
    fetch("/api/init").then((r) => r.ok ? setInitStatus("ready") : setInitStatus("error"))
      .catch(() => setInitStatus("error"));
    fetch("/api/mode").then((r) => r.json()).then((d) => {
      if (d?.ok && (d.mode === "test" || d.mode === "prod")) setDbMode(d.mode);
    }).catch(() => {});
  }, []);

  // Načti konverzace + odemčené providery z localStorage + stav Anthropic klíče ze serveru.
  const refreshUnlocked = useCallback(async () => {
    const set = new Set<Provider>();
    for (const p of Object.keys(PROVIDERS) as Provider[]) {
      const v = localStorage.getItem(PROVIDERS[p].storageKey);
      if (v && v.trim()) set.add(p);
    }
    try {
      const info = await fetch("/api/anthropic-key").then((r) => r.json());
      if (info?.hasKey) set.add("anthropic");
    } catch {}
    setUnlockedProviders(set);
  }, []);

  const reloadAgents = useCallback(() => {
    const all = loadAgents();
    setAgents(all);
    const activeId = loadActiveAgentId();
    if (activeId && all.some((a) => a.id === activeId)) {
      setActiveAgentIdState(activeId);
    } else {
      setActiveAgentIdState(null);
      if (activeId) saveActiveAgentId(null);
    }
  }, []);

  useEffect(() => {
    const list = loadConversations();
    setConversations(list);
    if (list.length > 0) {
      setActiveId(list[0].id);
      setMessages(loadMessages(list[0].id));
    }
    const storedModel = localStorage.getItem(MODEL_STORAGE_KEY);
    if (storedModel && (storedModel === AUTO_MODEL_ID || findModel(storedModel))) {
      setModelId(storedModel);
    }
    reloadAgents();
    refreshUnlocked();
    // Refresh po návratu z /settings nebo /agents/*.
    const onFocus = () => {
      refreshUnlocked();
      reloadAgents();
    };
    window.addEventListener("focus", onFocus);
    const onFillInput = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string }>).detail;
      if (detail?.text) setInput(detail.text);
    };
    window.addEventListener("rk:fill-input", onFillInput as EventListener);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("rk:fill-input", onFillInput as EventListener);
    };
  }, [refreshUnlocked, reloadAgents]);

  const selectAgent = useCallback((id: string | null) => {
    setActiveAgentIdState(id);
    saveActiveAgentId(id);
    if (id) {
      const ag = findAgent(loadAgents(), id);
      if (ag) {
        setModelId(ag.preferredModel);
        localStorage.setItem(MODEL_STORAGE_KEY, ag.preferredModel);
      }
    }
  }, []);

  const selectModel = useCallback((id: string) => {
    setModelId(id);
    localStorage.setItem(MODEL_STORAGE_KEY, id);
  }, []);

  // Persistuj konverzace při změně.
  useEffect(() => { saveConversations(conversations); }, [conversations]);
  useEffect(() => {
    if (activeId) saveMessages(activeId, messages);
  }, [activeId, messages]);

  // Autoscroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const newConversation = useCallback(() => {
    const id = uid();
    const c: Conversation = { id, title: "Nová konverzace", updatedAt: Date.now() };
    setConversations((prev) => [c, ...prev]);
    setActiveId(id);
    setMessages([]);
  }, []);

  const selectConversation = useCallback((id: string) => {
    if (sending) return;
    setActiveId(id);
    setMessages(loadMessages(id));
  }, [sending]);

  const deleteConversation = useCallback((id: string) => {
    deleteConversationStorage(id);
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (activeId === id) {
        const fallback = next[0]?.id ?? null;
        setActiveId(fallback);
        setMessages(fallback ? loadMessages(fallback) : []);
      }
      return next;
    });
  }, [activeId]);

  const ensureConversation = useCallback((title: string): string => {
    if (activeId) {
      setConversations((prev) => prev.map((c) =>
        c.id === activeId && c.title === "Nová konverzace"
          ? { ...c, title: firstLine(title), updatedAt: Date.now() }
          : c.id === activeId
            ? { ...c, updatedAt: Date.now() }
            : c
      ));
      return activeId;
    }
    const id = uid();
    const c: Conversation = { id, title: firstLine(title), updatedAt: Date.now() };
    setConversations((prev) => [c, ...prev]);
    setActiveId(id);
    return id;
  }, [activeId]);

  const sendMessage = useCallback(async (content: string) => {
    const text = content.trim();
    if (!text || sending) return;
    ensureConversation(text);
    setInput("");

    const activeAgent = findAgent(agents, activeAgentId);

    const userMsg: UIMessage = {
      id: uid(),
      role: "user",
      parts: [{ kind: "text", text }],
    };
    const assistantMsg: UIMessage = {
      id: uid(),
      role: "assistant",
      parts: [],
      streaming: true,
      agent: activeAgent
        ? { id: activeAgent.id, name: activeAgent.name, icon: activeAgent.icon, color: activeAgent.color }
        : undefined,
    };

    const baseMessages = [...messages, userMsg];
    setMessages([...baseMessages, assistantMsg]);
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const apiKeys = collectApiKeys();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: baseMessages.map((m) => ({
            role: m.role,
            content: m.parts.filter((p) => p.kind === "text").map((p) => (p as any).text).join(""),
          })),
          model: modelId,
          apiKeys,
          systemPrompt: activeAgent?.systemPrompt,
          allowedTools: activeAgent?.allowedTools,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => res.statusText);
        throw new Error(err || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Immutable update poslední assistant zprávy. Důležité kvůli React StrictMode
      // v dev módu (updater běží 2×), jinak by se text duplikoval.
      const updateLastAssistant = (patch: (msg: UIMessage) => UIMessage) => {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (last.role !== "assistant") return prev;
          const nextLast = patch(last);
          if (nextLast === last) return prev;
          return [...prev.slice(0, lastIdx), nextLast];
        });
      };

      const pushText = (chunk: string) => {
        updateLastAssistant((msg) => {
          const lastPart = msg.parts[msg.parts.length - 1];
          if (lastPart && lastPart.kind === "text") {
            const newParts = msg.parts.slice(0, -1);
            newParts.push({ kind: "text", text: lastPart.text + chunk });
            return { ...msg, parts: newParts };
          }
          return { ...msg, parts: [...msg.parts, { kind: "text", text: chunk }] };
        });
      };

      const pushToolUse = (name: string, input: unknown, toolId: string) => {
        updateLastAssistant((msg) => ({
          ...msg,
          parts: [...msg.parts, { kind: "tool", event: { id: toolId, name, input } }],
        }));
      };

      const pushToolResult = (name: string, ok: boolean, preview: string) => {
        updateLastAssistant((msg) => {
          // Najdi poslední tool část se stejným jménem, která ještě nemá výsledek.
          let targetIdx = -1;
          for (let i = msg.parts.length - 1; i >= 0; i--) {
            const p = msg.parts[i];
            if (p.kind === "tool" && p.event.name === name && p.event.resultPreview === undefined) {
              targetIdx = i;
              break;
            }
          }
          if (targetIdx === -1) return msg;
          const target = msg.parts[targetIdx];
          if (target.kind !== "tool") return msg;
          const updated: MessagePart = {
            kind: "tool",
            event: { ...target.event, ok, resultPreview: preview },
          };
          const newParts = [...msg.parts];
          newParts[targetIdx] = updated;
          return { ...msg, parts: newParts };
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIdx: number;
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const json = dataLine.slice(5).trim();
          if (!json) continue;
          let ev: ServerEvent;
          try { ev = JSON.parse(json); } catch { continue; }

          if (ev.type === "text") pushText(ev.text);
          else if (ev.type === "tool_use") pushToolUse(ev.name, ev.input, uid());
          else if (ev.type === "tool_result") pushToolResult(ev.name, ev.ok, ev.preview);
          else if (ev.type === "used_model") {
            updateLastAssistant((msg) => ({
              ...msg,
              usedModel: { id: ev.model_id, label: ev.label, provider: ev.provider },
            }));
          }
          else if (ev.type === "error") pushText(`\n\n> **Chyba:** ${ev.error}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const lastIdx = prev.length - 1;
        const last = prev[lastIdx];
        if (last.role !== "assistant") return prev;
        const errPart: MessagePart = { kind: "text", text: `\n\n> **Chyba při komunikaci:** ${msg}` };
        // Idempotentní: pokud už tam stejná chyba je, nepřidávej znovu.
        const lastPart = last.parts[last.parts.length - 1];
        if (lastPart && lastPart.kind === "text" && lastPart.text.endsWith(errPart.text)) return prev;
        return [...prev.slice(0, lastIdx), { ...last, parts: [...last.parts, errPart] }];
      });
    } finally {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const lastIdx = prev.length - 1;
        const last = prev[lastIdx];
        if (last.role !== "assistant" || !last.streaming) return prev;
        return [...prev.slice(0, lastIdx), { ...last, streaming: false }];
      });
      setSending(false);
      abortRef.current = null;
    }
  }, [messages, sending, ensureConversation, modelId, agents, activeAgentId]);

  const handleQuickAction = useCallback((prompt: string) => {
    if (sending) return;
    sendMessage(prompt);
  }, [sending, sendMessage]);

  const isEmpty = messages.length === 0;
  const showInitBanner = initStatus === "error";

  return (
    <div className="flex h-screen">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={newConversation}
        onDelete={deleteConversation}
        agents={agents}
        activeAgentId={activeAgentId}
        onSelectAgent={selectAgent}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-3">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            {(() => {
              const ag = findAgent(agents, activeAgentId);
              if (!ag) return null;
              return (
                <span
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium text-white"
                  style={{ background: ag.color }}
                >
                  <span>{ag.icon}</span>
                  {ag.name}
                </span>
              );
            })()}
            <span>
              {isEmpty ? "Jak vám mohu dnes pomoci?" : conversations.find((c) => c.id === activeId)?.title ?? ""}
            </span>
          </div>
          <div className="text-[11px] text-text-dim">
            {initStatus === "ready" && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" /> databáze připravena</span>}
            {initStatus === "idle" && <span>…</span>}
            {initStatus === "error" && <span className="text-red-400">databáze nedostupná</span>}
          </div>
        </header>

        {dbMode === "test" && (
          <div className="flex items-center justify-between gap-3 border-b border-yellow-500/40 bg-yellow-500/15 px-6 py-2 text-xs font-medium text-yellow-200">
            <span>🧪 TESTOVACÍ REŽIM — změny neovlivní produkční data</span>
            <a href="/import" className="rounded-md border border-yellow-500/50 bg-yellow-500/10 px-2 py-0.5 text-[11px] hover:bg-yellow-500/25">
              Spravovat →
            </a>
          </div>
        )}

        {showInitBanner && (
          <div className="border-b border-red-900/60 bg-red-950/40 px-6 py-2 text-xs text-red-200">
            Inicializace databáze selhala. Zkontrolujte server log.
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {isEmpty ? (
              <EmptyState onPick={handleQuickAction} />
            ) : (
              <div className="space-y-6">
                {messages.map((m) => <ChatMessage key={m.id} message={m} />)}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border bg-bg px-4 py-3">
          <div className="mx-auto w-full max-w-3xl">
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={() => sendMessage(input)}
              disabled={sending}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="text-[11px] text-text-dim">
                Agent může dělat chyby. Výsledky si v kritických případech ověřte.
              </div>
              <ModelPicker modelId={modelId} onChange={selectModel} unlockedProviders={unlockedProviders} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-8 pt-8">
      <div className="flex items-center gap-3">
        <Logo size={44} />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-white">Dobrý den. Jak vám mohu pomoci?</h1>
        <p className="mt-2 text-sm text-text-muted">
          Analyzuji klienty, leady, nemovitosti a transakce — generuji grafy i reporty.
        </p>
      </div>
      <div className="w-full">
        <MorningBriefing />
      </div>
      <div className="w-full">
        <Dashboard />
      </div>
      <div className="w-full">
        <QuickActions onPick={onPick} />
      </div>
    </div>
  );
}
