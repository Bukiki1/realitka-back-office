"use client";

import Link from "next/link";
import { Logo } from "./Logo";
import type { Agent } from "@/lib/agents";

export type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
};

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  agents,
  activeAgentId,
  onSelectAgent,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  agents: Agent[];
  activeAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-bg-sidebar">
      <div className="flex items-center justify-between px-4 py-4 border-b border-border-subtle">
        <Logo />
      </div>

      <div className="px-3 py-3">
        <button
          onClick={onNew}
          className="group flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-bg-panel px-3 py-2 text-sm font-medium text-text transition hover:border-accent hover:bg-bg-hover"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Nová konverzace
        </button>
      </div>

      {/* Agenti */}
      <div className="px-3 pb-1">
        <div className="flex items-center justify-between px-1 pb-1">
          <div className="text-[11px] uppercase tracking-wider text-text-dim">Agenti</div>
          <Link
            href="/agents/new"
            title="Nový agent"
            className="rounded-md p-1 text-text-dim transition hover:bg-bg-panel hover:text-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </Link>
        </div>
        <ul className="space-y-0.5">
          <li>
            <button
              onClick={() => onSelectAgent(null)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                activeAgentId === null
                  ? "bg-bg-hover text-white"
                  : "text-text-muted hover:bg-bg-panel"
              }`}
            >
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px]"
                style={{ background: "linear-gradient(135deg, #2563eb, #0f172a)" }}
                aria-hidden
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M4 21V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v16" stroke="#fff" strokeWidth="1.6" />
                  <path d="M3 21h18" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <span className="truncate">Výchozí (Realitka)</span>
            </button>
          </li>
          {agents.map((a) => {
            const isActive = a.id === activeAgentId;
            return (
              <li key={a.id}>
                <div
                  className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                    isActive ? "bg-bg-hover text-white" : "text-text hover:bg-bg-panel"
                  }`}
                >
                  <button
                    onClick={() => onSelectAgent(a.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-sm"
                      style={{ background: a.color }}
                      aria-hidden
                    >
                      {a.icon}
                    </span>
                    <span className="truncate">{a.name}</span>
                  </button>
                  <Link
                    href={`/agents/${encodeURIComponent(a.id)}/edit`}
                    title="Upravit"
                    className="opacity-0 transition group-hover:opacity-100 text-text-dim hover:text-white"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M4 20h4L20 8l-4-4L4 16v4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="px-3 pb-2 pt-3 text-[11px] uppercase tracking-wider text-text-dim">Historie</div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-text-dim">
            Žádné konverzace.
          </div>
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => {
              const isActive = c.id === activeId;
              return (
                <li key={c.id}>
                  <div
                    className={`group flex items-center justify-between gap-1 rounded-lg px-3 py-2 text-sm transition cursor-pointer ${
                      isActive
                        ? "bg-bg-hover text-white"
                        : "text-text hover:bg-bg-panel"
                    }`}
                    onClick={() => onSelect(c.id)}
                  >
                    <span className="truncate">{c.title || "Nová konverzace"}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                      className="opacity-0 transition group-hover:opacity-100 text-text-dim hover:text-red-400"
                      aria-label="Smazat"
                      title="Smazat konverzaci"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M6 7h12M9 7V4h6v3M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="flex items-center justify-between border-t border-border-subtle px-3 py-3">
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-text-muted transition hover:bg-bg-panel hover:text-white"
          title="Nastavení API klíčů"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
          Nastavení
        </Link>
      </div>
    </aside>
  );
}
