"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AUTO_MODEL_ID,
  MODELS,
  PROVIDERS,
  findModel,
  type ModelDef,
  type Provider,
} from "@/lib/models";
import { AutoIcon, ProviderIcon } from "./ProviderIcon";

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function ModelPicker({
  modelId,
  onChange,
  unlockedProviders,
}: {
  modelId: string;
  onChange: (id: string) => void;
  unlockedProviders: Set<Provider>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current: ModelDef | null = modelId === AUTO_MODEL_ID ? null : findModel(modelId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const q = normalize(query.trim());
  const autoMatches = !q || "auto ✨ automaticky".includes(q);

  const filtered = useMemo(() => {
    if (!q) return MODELS;
    return MODELS.filter((m) => {
      const hay = normalize(`${m.label} ${m.id} ${PROVIDERS[m.provider].label}`);
      return hay.includes(q);
    });
  }, [q]);

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, ModelDef[]>>((acc, m) => {
      (acc[m.provider] ??= []).push(m);
      return acc;
    }, {});
  }, [filtered]);

  const isLocked = (m: ModelDef) => !!m.locked && !unlockedProviders.has(m.provider);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (autoMatches) {
      onChange(AUTO_MODEL_ID);
      setOpen(false);
      return;
    }
    const firstSelectable = filtered.find((m) => !isLocked(m));
    if (firstSelectable) {
      onChange(firstSelectable.id);
      setOpen(false);
    }
  };

  const triggerLabel =
    modelId === AUTO_MODEL_ID ? "Auto" : current?.label ?? "Vybrat model";
  const triggerSub =
    modelId === AUTO_MODEL_ID
      ? "AI vybere"
      : current
        ? PROVIDERS[current.provider].label
        : "";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text transition hover:border-accent hover:bg-bg-hover"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {modelId === AUTO_MODEL_ID ? <AutoIcon size={14} /> : current ? <ProviderIcon provider={current.provider} size={14} /> : null}
        <span className="truncate">{triggerLabel}</span>
        <span className="text-text-dim">{triggerSub}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-full right-0 z-20 mb-2 flex max-h-[70vh] w-80 flex-col rounded-lg border border-border bg-bg-sidebar shadow-soft"
        >
          <div className="border-b border-border-subtle bg-bg-sidebar p-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5">
              <span className="text-text-dim"><SearchIcon /></span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Vyhledat model…"
                className="flex-1 bg-transparent text-xs text-text placeholder:text-text-dim focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-text-dim hover:text-text"
                  aria-label="Smazat vyhledávání"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-1">
            {/* Auto speciální položka */}
            {autoMatches && (
              <div className="py-1">
                <button
                  type="button"
                  onClick={() => {
                    onChange(AUTO_MODEL_ID);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition ${
                    modelId === AUTO_MODEL_ID
                      ? "bg-bg-hover text-white"
                      : "text-text hover:bg-bg-panel"
                  }`}
                >
                  <AutoIcon size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">Auto</span>
                      <span aria-hidden>✨</span>
                    </div>
                    <div className="text-[10px] text-text-dim">AI vybere nejlepší model pro dotaz</div>
                  </div>
                  {modelId === AUTO_MODEL_ID && (
                    <span className="shrink-0 text-accent">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M5 12l4 4 10-10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </button>
                <div className="my-1 border-t border-border-subtle" />
              </div>
            )}

            {filtered.length === 0 && !autoMatches ? (
              <div className="px-3 py-6 text-center text-xs text-text-dim">
                Žádný model neodpovídá.
              </div>
            ) : (
              Object.entries(grouped).map(([provider, models]) => (
                <div key={provider} className="py-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wider text-text-dim">
                    <ProviderIcon provider={provider as Provider} size={10} />
                    {PROVIDERS[provider as Provider].label}
                  </div>
                  {models.map((m) => {
                    const selected = m.id === modelId;
                    const locked = isLocked(m);
                    const title = locked ? "Přidejte API klíč v nastavení" : undefined;
                    const btnClass = `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                      locked
                        ? "cursor-pointer text-text-dim hover:bg-bg-panel/50"
                        : selected
                          ? "bg-bg-hover text-white"
                          : "text-text hover:bg-bg-panel"
                    }`;
                    const inner = (
                      <>
                        <ProviderIcon provider={m.provider} size={12} />
                        <span className="flex-1 truncate">{m.label}</span>
                        {locked ? (
                          <span className="shrink-0 text-text-dim"><LockIcon /></span>
                        ) : selected ? (
                          <span className="shrink-0 text-accent">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <path d="M5 12l4 4 10-10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                        ) : null}
                      </>
                    );
                    return locked ? (
                      <Link
                        key={m.id}
                        href="/settings"
                        title={title}
                        onClick={() => setOpen(false)}
                        className={btnClass}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onChange(m.id);
                          setOpen(false);
                        }}
                        className={btnClass}
                      >
                        {inner}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
