"use client";

import { useState } from "react";
import {
  ALL_TOOL_NAMES,
  COLOR_PALETTE,
  EMOJI_PALETTE,
  TOOL_LABELS,
  type Agent,
} from "@/lib/agents";
import { AUTO_MODEL_ID, MODELS, PROVIDERS, type Provider } from "@/lib/models";

type Props = {
  initial: Agent;
  mode: "create" | "edit";
  unlockedProviders: Set<Provider>;
  onSave: (agent: Agent) => void;
  onCancel: () => void;
  onDelete?: () => void;
};

export function AgentForm({ initial, mode, unlockedProviders, onSave, onCancel, onDelete }: Props) {
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon);
  const [color, setColor] = useState(initial.color);
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt);
  const [preferredModel, setPreferredModel] = useState(initial.preferredModel);
  const [allowedTools, setAllowedTools] = useState<string[]>([...initial.allowedTools]);
  const [autoTools, setAutoTools] = useState<boolean>(initial.allowedTools.length === 0);
  const [error, setError] = useState<string | null>(null);

  const toggleTool = (n: string) => {
    setAllowedTools((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  };

  const toggleAuto = () => {
    setAutoTools((prev) => {
      const next = !prev;
      if (next) {
        // Přepnuto na Auto → vyčisti ruční výběr (prázdné pole = všechny nástroje).
        setAllowedTools([]);
      } else if (allowedTools.length === 0) {
        // Přepnuto z Auto na ruční výběr bez předchozího výběru → předvyplň rozumné výchozí.
        setAllowedTools(["query_database", "search_properties"]);
      }
      return next;
    });
  };

  const submit = () => {
    if (!name.trim()) return setError("Vyplň jméno agenta.");
    if (!systemPrompt.trim()) return setError("Vyplň system prompt.");
    if (!autoTools && allowedTools.length === 0) return setError("Vyber alespoň jeden nástroj (nebo zapni Auto).");
    setError(null);
    onSave({
      ...initial,
      name: name.trim(),
      icon,
      color,
      systemPrompt: systemPrompt.trim(),
      preferredModel,
      allowedTools: autoTools ? [] : allowedTools,
    });
  };

  const grouped = MODELS.reduce<Record<Provider, typeof MODELS>>((acc, m) => {
    (acc[m.provider] ??= [] as any).push(m);
    return acc;
  }, {} as Record<Provider, typeof MODELS>);

  return (
    <div className="space-y-6">
      {/* Preview */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-sidebar p-4">
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-xl shadow-soft"
          style={{ background: color }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{name || "Nový agent"}</div>
          <div className="text-[11px] text-text-dim">
            {autoTools
              ? "✨ Auto nástroje"
              : `${allowedTools.length} nástroj${allowedTools.length === 1 ? "" : allowedTools.length >= 2 && allowedTools.length <= 4 ? "e" : "ů"}`}
            {" · "}
            {preferredModel === AUTO_MODEL_ID ? "Auto model" : preferredModel}
          </div>
        </div>
      </div>

      {/* Jméno */}
      <Field label="Jméno">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Např. Analytik"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
          autoComplete="off"
        />
      </Field>

      {/* Ikona */}
      <Field label="Ikona">
        <div className="grid grid-cols-10 gap-1.5">
          {EMOJI_PALETTE.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setIcon(e)}
              className={`grid aspect-square place-items-center rounded-md border text-lg transition ${
                icon === e ? "border-accent bg-bg-hover" : "border-border bg-bg-panel hover:bg-bg-hover"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </Field>

      {/* Barva */}
      <Field label="Barva">
        <div className="flex flex-wrap gap-2">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Barva ${c}`}
              className={`h-7 w-7 rounded-md transition ${
                color === c ? "ring-2 ring-offset-2 ring-offset-bg-sidebar ring-white" : ""
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>

      {/* System prompt */}
      <Field label="System prompt">
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          placeholder="Popiš, jak se má agent chovat, v jakém stylu odpovídá, na co se specializuje…"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
        />
      </Field>

      {/* Preferovaný model */}
      <Field label="Preferovaný model">
        <select
          value={preferredModel}
          onChange={(e) => setPreferredModel(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
        >
          <option value={AUTO_MODEL_ID}>✨ Auto — AI vybere nejlepší model</option>
          {(Object.keys(grouped) as Provider[]).map((p) => (
            <optgroup key={p} label={PROVIDERS[p].label}>
              {grouped[p].map((m) => {
                const locked = !!m.locked && !unlockedProviders.has(m.provider);
                return (
                  <option key={m.id} value={m.id} disabled={locked}>
                    {m.label}{locked ? " (🔒 odemkni v /settings)" : ""}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
      </Field>

      {/* Nástroje */}
      <Field label="Nástroje">
        <div className="space-y-2">
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
              autoTools ? "border-accent bg-bg-panel" : "border-border bg-bg hover:bg-bg-panel"
            }`}
          >
            <input
              type="checkbox"
              checked={autoTools}
              onChange={toggleAuto}
              className="h-4 w-4 accent-accent"
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-text">✨ Auto — agent sám vybere nástroje</div>
              <div className="text-[11px] text-text-dim">
                Agent má přístup ke všem nástrojům a sám rozhoduje, které použije.
              </div>
            </div>
          </label>

          {!autoTools && (
            <div className="space-y-2 pt-1">
              {ALL_TOOL_NAMES.map((n) => {
                const checked = allowedTools.includes(n);
                return (
                  <label
                    key={n}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                      checked ? "border-accent bg-bg-panel" : "border-border bg-bg hover:bg-bg-panel"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTool(n)}
                      className="h-4 w-4 accent-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-text">{TOOL_LABELS[n]}</div>
                      <div className="font-mono text-[11px] text-text-dim">{n}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </Field>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div>
          {mode === "edit" && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg border border-border bg-bg-panel px-3 py-2 text-xs text-red-400 hover:border-red-400"
            >
              Smazat agenta
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-bg-panel px-4 py-2 text-sm text-text hover:border-accent hover:bg-bg-hover"
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {mode === "create" ? "Vytvořit agenta" : "Uložit změny"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">{label}</div>
      {children}
    </div>
  );
}
