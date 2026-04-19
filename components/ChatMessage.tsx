"use client";

import { Markdown } from "./Markdown";
import { ThinkingSection, type ToolEvent } from "./ThinkingSection";
import { ProviderIcon } from "./ProviderIcon";
import { MessageExportButtons } from "./MessageExportButtons";
import type { Provider } from "@/lib/models";

export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "tool"; event: ToolEvent };

export type UsedModel = {
  id: string;
  label: string;
  provider: Provider;
};

export type MessageAgent = {
  id: string;
  name: string;
  icon: string;
  color: string;
};

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  streaming?: boolean;
  usedModel?: UsedModel;
  agent?: MessageAgent;
};

function UserAvatar() {
  return (
    <div
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold text-white shadow-soft"
      style={{ background: "#1e3a8a" }}
      aria-label="Pepa"
    >
      P
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[80%] rounded-2xl bg-bg-panel px-4 py-2.5 text-sm text-text border border-border">
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
      <UserAvatar />
    </div>
  );
}

function AssistantAvatar({ agent }: { agent?: MessageAgent }) {
  if (agent) {
    return (
      <div
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base shadow-soft"
        style={{ background: agent.color }}
        aria-label={agent.name}
        title={agent.name}
      >
        {agent.icon}
      </div>
    );
  }
  return (
    <div
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg shadow-soft"
      style={{ background: "linear-gradient(135deg, #2563eb, #0f172a)" }}
      aria-label="Realitka Agent"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 21V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v16"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M3 21h18" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        <path
          d="M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2"
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function UsedModelBadge({ model }: { model: UsedModel }) {
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-dim">
      <ProviderIcon provider={model.provider} size={12} />
      <span>Použitý model:</span>
      <span className="text-text-muted">{model.label}</span>
    </div>
  );
}

export function ChatMessage({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
    return <UserBubble text={text} />;
  }

  const toolEvents: ToolEvent[] = message.parts
    .filter((p): p is Extract<MessagePart, { kind: "tool" }> => p.kind === "tool")
    .map((p) => p.event);

  const textContent = message.parts
    .filter((p): p is Extract<MessagePart, { kind: "text" }> => p.kind === "text")
    .map((p) => p.text)
    .join("");

  const showThinking = message.streaming || toolEvents.length > 0;

  return (
    <div className="flex gap-3">
      <AssistantAvatar agent={message.agent} />
      <div className="min-w-0 flex-1 space-y-3">
        {message.agent && (
          <div className="text-[11px] text-text-dim">{message.agent.name}</div>
        )}
        {showThinking && (
          <ThinkingSection events={toolEvents} streaming={message.streaming} />
        )}

        {textContent && (
          <div className={message.streaming ? "caret" : ""}>
            <Markdown content={textContent} />
          </div>
        )}

        {!message.streaming && textContent && (
          <MessageExportButtons text={textContent} />
        )}

        {message.streaming && !textContent && toolEvents.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span>Přemýšlím</span>
            <span className="rk-dots" aria-hidden>
              <span /><span /><span />
            </span>
          </div>
        )}

        {!message.streaming && message.usedModel && <UsedModelBadge model={message.usedModel} />}
      </div>
    </div>
  );
}
