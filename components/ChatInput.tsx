"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

const TEXTLIKE_EXT = /\.(txt|md|markdown|csv|tsv|json|log|xml|html?|ya?ml|ini|conf|sql|py|js|ts|tsx|jsx|sh)$/i;
const TEXTLIKE_MIME = /^text\/|application\/(json|xml|x-yaml|yaml|sql)/;
const MAX_BYTES = 200_000;

export function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "Napište dotaz… (Enter odeslat, Shift+Enter nový řádek)",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<SpeechRec | null>(null);

  const [recording, setRecording] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    setMicSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);

  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(null), 3500);
    return () => clearTimeout(id);
  }, [status]);

  // Rozpojení rekordéru při unmountu.
  useEffect(() => {
    return () => {
      try { recRef.current?.stop(); } catch {}
      recRef.current = null;
    };
  }, []);

  const pickFile = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Reset, aby šel stejný soubor vybrat znova.
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setStatus(`Soubor „${f.name}" je moc velký (${(f.size / 1024).toFixed(0)} kB, max ${Math.round(MAX_BYTES / 1024)} kB).`);
      return;
    }
    const isText = TEXTLIKE_EXT.test(f.name) || TEXTLIKE_MIME.test(f.type);
    if (!isText) {
      setStatus(`„${f.name}" — podporovány jsou pouze textové soubory (txt, md, csv, json, log, …).`);
      return;
    }
    try {
      const text = await f.text();
      const header = `\n\n--- Příloha: ${f.name} (${f.size} B) ---\n`;
      const next = (value || "").replace(/\s+$/, "") + header + text + "\n--- konec přílohy ---\n";
      onChange(next);
      setStatus(`Přiloženo: ${f.name}`);
    } catch (err) {
      setStatus(`Chyba čtení: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [value, onChange]);

  const stopMic = useCallback(() => {
    try { recRef.current?.stop(); } catch {}
  }, []);

  const startMic = useCallback(() => {
    if (!micSupported) {
      setStatus("Tento prohlížeč nepodporuje rozpoznávání řeči. Zkuste Chrome nebo Edge.");
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "cs-CZ";
    rec.interimResults = true;
    rec.continuous = true;

    const base = (value || "").replace(/\s+$/, "");
    let committed = "";

    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) committed += text;
        else interim += text;
      }
      const sep = base && !base.endsWith("\n") ? " " : "";
      onChange(base + sep + committed + interim);
    };
    rec.onerror = (ev) => {
      const code = ev?.error || "";
      const map: Record<string, string> = {
        "not-allowed": "Přístup k mikrofonu zamítnut. Povolte mikrofon v nastavení prohlížeče.",
        "service-not-allowed": "Služba rozpoznávání řeči je zakázaná.",
        "no-speech": "Nezachycen žádný hlas.",
        "audio-capture": "Žádný mikrofon nenalezen.",
        "network": "Chyba sítě při rozpoznávání řeči.",
      };
      setStatus(map[code] || `Chyba mikrofonu: ${code || "neznámá"}`);
    };
    rec.onend = () => {
      setRecording(false);
      recRef.current = null;
    };

    recRef.current = rec;
    try {
      rec.start();
      setRecording(true);
      setStatus(null);
    } catch (err) {
      setStatus(`Mikrofon nelze spustit: ${err instanceof Error ? err.message : String(err)}`);
      setRecording(false);
      recRef.current = null;
    }
  }, [micSupported, value, onChange]);

  const toggleMic = useCallback(() => {
    if (recording) stopMic();
    else startMic();
  }, [recording, stopMic, startMic]);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!disabled && value.trim()) onSubmit(); }}
      className="relative flex items-end gap-1.5 rounded-2xl border border-border bg-bg-panel px-2.5 py-2.5 shadow-soft focus-within:border-accent"
    >
      {status && (
        <div className="pointer-events-none absolute -top-8 left-2 right-2 truncate rounded-md bg-black/85 px-3 py-1.5 text-[11px] text-text-muted shadow-soft border border-border">
          {status}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.html,.htm,.yaml,.yml,.ini,.conf,.sql,.py,.js,.ts,.tsx,.jsx,.sh,text/*,application/json,application/xml"
        className="hidden"
        onChange={onFileChange}
      />

      <button
        type="button"
        onClick={pickFile}
        title="Přiložit textový soubor (txt, md, csv, json, log, …)"
        aria-label="Přiložit soubor"
        className="mb-0.5 grid h-9 w-9 place-items-center rounded-xl text-text-dim transition hover:bg-bg-hover hover:text-text"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.64 16.2a2 2 0 0 1-2.83-2.83L15 5.17"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!disabled && value.trim()) onSubmit();
          }
        }}
        rows={1}
        placeholder={recording ? "Mluvte… (klik na mikrofon pro ukončení)" : placeholder}
        className="flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-text placeholder:text-text-dim focus:outline-none"
      />

      <button
        type="button"
        onClick={toggleMic}
        title={
          !micSupported
            ? "Prohlížeč nepodporuje rozpoznávání řeči"
            : recording
              ? "Zastavit diktování"
              : "Diktovat česky"
        }
        aria-label="Diktování"
        aria-pressed={recording}
        disabled={!micSupported}
        className={`relative mb-0.5 grid h-9 w-9 place-items-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-40 ${
          recording
            ? "bg-red-950/60 text-red-300 ring-1 ring-red-500/60"
            : "text-text-dim hover:bg-bg-hover hover:text-text"
        }`}
      >
        {recording && (
          <span className="absolute -top-0.5 -right-0.5 grid h-2.5 w-2.5 place-items-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
            <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
        )}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 11a7 7 0 0 0 14 0 M12 18v3 M8 21h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-white transition enabled:hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Odeslat"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}
