"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type TableKey = "clients" | "properties" | "leads" | "transactions" | "calendar";

type DbField = { key: string; label: string; required?: boolean; hint?: string; readonly?: boolean };

const FIELD_DEFS: Record<TableKey, DbField[]> = {
  clients: [
    { key: "name", label: "Jméno", required: true },
    { key: "email", label: "Email", required: true },
    { key: "phone", label: "Telefon", required: true },
    { key: "source", label: "Zdroj", required: true, hint: "web / doporučení / inzerát / sociální sítě" },
    { key: "budget_min", label: "Rozpočet od" },
    { key: "budget_max", label: "Rozpočet do" },
    { key: "preferred_locality", label: "Preferovaná lokalita" },
    { key: "preferred_rooms", label: "Dispozice" },
    { key: "preferred_type", label: "Typ (byt/dům/komerční)" },
    { key: "notes", label: "Poznámky" },
  ],
  properties: [
    { key: "address", label: "Adresa", required: true },
    { key: "city", label: "Město", required: true },
    { key: "district", label: "Čtvrť", required: true },
    { key: "type", label: "Typ", required: true, hint: "byt / dům / komerční" },
    { key: "price", label: "Cena (Kč)", required: true },
    { key: "area_m2", label: "Plocha (m²)", required: true },
    { key: "rooms", label: "Pokoje" },
    { key: "status", label: "Stav", hint: "aktivní / prodáno / rezervováno" },
    { key: "description", label: "Popis", required: true },
  ],
  leads: [
    { key: "client_name", label: "Klient (jméno)", required: true },
    { key: "property_address", label: "Nemovitost (adresa)", required: true },
    { key: "status", label: "Stav", hint: "nový / kontaktován / prohlídka / nabídka / uzavřen" },
    { key: "source", label: "Zdroj", required: true },
    { key: "last_contact_at", label: "Datum posl. kontaktu" },
    { key: "next_action", label: "Další krok" },
    { key: "estimated_commission", label: "Odhad provize" },
  ],
  transactions: [
    { key: "property_address", label: "Nemovitost (adresa)", required: true, hint: "vyhledá nemovitost podle adresy" },
    { key: "client_name", label: "Klient (jméno)", required: true, hint: "vyhledá klienta podle jména" },
    { key: "sale_price", label: "Prodejní cena (Kč)", required: true },
    { key: "commission", label: "Provize (Kč)", required: true },
    { key: "transaction_date", label: "Datum transakce", required: true, hint: "YYYY-MM-DD" },
  ],
  calendar: [
    { key: "title", label: "Název", required: true },
    { key: "start_time", label: "Začátek", required: true, hint: "YYYY-MM-DD HH:MM" },
    { key: "end_time", label: "Konec", required: true, hint: "YYYY-MM-DD HH:MM" },
    { key: "type", label: "Typ", required: true, hint: "prohlídka / meeting / hovor / jiné" },
    { key: "location", label: "Místo" },
    { key: "notes", label: "Poznámky" },
    { key: "client_id", label: "Klient (id)" },
    { key: "property_id", label: "Nemovitost (id)" },
  ],
};

const TABLE_META: Record<TableKey, {
  title: string;
  icon: string;
  endpointTable: string;
  apiList: string;
  apiItem: (id: number) => string;
  listKey: string;
}> = {
  clients:      { title: "Import klientů",      icon: "👥", endpointTable: "clients",        apiList: "/api/data/clients",      apiItem: (id) => `/api/data/clients/${id}`,     listKey: "clients" },
  properties:   { title: "Import nemovitostí",  icon: "🏠", endpointTable: "properties",     apiList: "/api/data/properties",   apiItem: (id) => `/api/data/properties/${id}`,  listKey: "properties" },
  leads:        { title: "Import leadů",        icon: "📊", endpointTable: "leads",          apiList: "/api/data/leads",        apiItem: (id) => `/api/data/leads/${id}`,       listKey: "leads" },
  transactions: { title: "Import transakcí",    icon: "💰", endpointTable: "transactions",   apiList: "/api/data/transactions", apiItem: (id) => `/api/data/transactions/${id}`, listKey: "transactions" },
  calendar:     { title: "Import kalendáře",    icon: "📅", endpointTable: "calendar_events", apiList: "/api/data/calendar",    apiItem: (id) => `/api/data/calendar/${id}`,     listKey: "events" },
};

type Preview = {
  columns: string[];
  sample: Array<Record<string, unknown>>;
  rows: Array<Record<string, unknown>>;
  total: number;
  sheetName: string;
};

type CommitResult = {
  total: number;
  inserted: number;
  skipped: number;
  error_count: number;
  errors: Array<{ row: number; error: string }>;
  warnings?: Array<{ row: number; warning: string }>;
  warning_count?: number;
  strategy?: string;
};

function autoGuessMapping(columns: string[], fields: DbField[]): Record<string, string> {
  const out: Record<string, string> = {};
  const norm = (s: string) => s.toLowerCase().replace(/[áä]/g, "a").replace(/[éě]/g, "e")
    .replace(/í/g, "i").replace(/[óö]/g, "o").replace(/[úů]/g, "u").replace(/ý/g, "y")
    .replace(/č/g, "c").replace(/ď/g, "d").replace(/ň/g, "n").replace(/ř/g, "r")
    .replace(/š/g, "s").replace(/ť/g, "t").replace(/ž/g, "z").replace(/[^a-z0-9]+/g, "_");
  const SYNONYMS: Record<string, string[]> = {
    name: ["jmeno", "klient", "nazev", "name"],
    email: ["email", "e_mail", "mail"],
    phone: ["telefon", "tel", "phone", "mobil"],
    source: ["zdroj", "source"],
    budget_min: ["rozpocet_od", "rozpocet_min", "min_budget", "budget_min"],
    budget_max: ["rozpocet_do", "rozpocet_max", "max_budget", "budget_max"],
    preferred_locality: ["lokalita", "preferovana_lokalita", "locality"],
    preferred_rooms: ["dispozice", "pokoje_pref", "rooms_pref"],
    preferred_type: ["typ_pref", "typ_nemovitosti", "preferovany_typ"],
    notes: ["poznamky", "poznamka", "notes"],
    address: ["adresa", "address", "ulice"],
    city: ["mesto", "city"],
    district: ["ctvrt", "okres", "district"],
    type: ["typ", "type"],
    price: ["cena", "price", "cena_kc"],
    area_m2: ["plocha", "plocha_m2", "area", "area_m2", "m2"],
    rooms: ["pokoje", "rooms"],
    status: ["stav", "status"],
    description: ["popis", "description"],
    client_name: ["klient", "jmeno_klienta", "client_name"],
    property_address: ["nemovitost", "adresa_nemovitosti", "property_address"],
    last_contact_at: ["datum_posledniho_kontaktu", "last_contact_at", "datum_kontaktu"],
    next_action: ["dalsi_krok", "next_action"],
    estimated_commission: ["odhad_provize", "provize", "commission"],
    sale_price: ["prodejni_cena", "cena_prodeje", "sale_price"],
    commission: ["provize", "commission"],
    transaction_date: ["datum_transakce", "datum_prodeje", "transaction_date", "datum"],
    title: ["nazev", "titulek", "title", "udalost"],
    start_time: ["zacatek", "start", "start_time", "od"],
    end_time: ["konec", "end", "end_time", "do"],
    location: ["misto", "adresa_mista", "location"],
    client_id: ["klient_id", "client_id", "id_klienta"],
    property_id: ["nemovitost_id", "property_id", "id_nemovitosti"],
  };
  for (const col of columns) {
    const n = norm(col);
    for (const f of fields) {
      if (out[col]) break;
      const candidates = [f.key, norm(f.label), ...(SYNONYMS[f.key] ?? [])];
      if (candidates.some((c) => norm(c) === n)) {
        out[col] = f.key;
        break;
      }
    }
  }
  return out;
}

function EditModal({
  table,
  record,
  onClose,
  onSaved,
}: {
  table: TableKey;
  record: Record<string, unknown>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fields = useMemo(() => EDIT_FIELDS[table], [table]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields) {
      const v = record[f.key];
      init[f.key] = v === null || v === undefined ? "" : String(v);
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = Number(record.id);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        const v = values[f.key];
        if (f.numeric) {
          if (v === "") payload[f.key] = "";
          else {
            const n = Number(v.replace(/\s/g, "").replace(/,/g, "."));
            if (Number.isFinite(n)) payload[f.key] = n;
          }
        } else {
          payload[f.key] = v;
        }
      }
      const res = await fetch(TABLE_META[table].apiItem(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Uložení selhalo.");
      } else {
        onSaved();
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div
        className="mt-12 w-full max-w-xl rounded-xl border border-border bg-bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {TABLE_META[table].icon} Upravit záznam #{id}
          </h3>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-xs text-text-dim hover:bg-bg-hover">✕</button>
        </div>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-[11px] font-medium text-text-dim">
                {f.label}{f.hint ? <span className="ml-2 font-normal text-text-dim/70">{f.hint}</span> : null}
              </label>
              {f.textarea ? (
                <textarea
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text focus:border-accent focus:outline-none"
                />
              ) : (
                <input
                  type="text"
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text focus:border-accent focus:outline-none"
                />
              )}
            </div>
          ))}
        </div>
        {error && (
          <div className="mt-3 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-text hover:border-accent disabled:opacity-50">Zrušit</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
            {busy ? "Ukládám…" : "Uložit"}
          </button>
        </div>
      </div>
    </div>
  );
}

type EditField = { key: string; label: string; hint?: string; numeric?: boolean; textarea?: boolean };

const EDIT_FIELDS: Record<TableKey, EditField[]> = {
  clients: [
    { key: "name", label: "Jméno" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Telefon" },
    { key: "source", label: "Zdroj", hint: "web / doporučení / inzerát / sociální sítě" },
    { key: "budget_min", label: "Rozpočet od", numeric: true },
    { key: "budget_max", label: "Rozpočet do", numeric: true },
    { key: "preferred_locality", label: "Preferovaná lokalita" },
    { key: "preferred_rooms", label: "Dispozice" },
    { key: "preferred_type", label: "Typ" },
    { key: "notes", label: "Poznámky", textarea: true },
  ],
  properties: [
    { key: "address", label: "Adresa" },
    { key: "city", label: "Město" },
    { key: "district", label: "Čtvrť" },
    { key: "type", label: "Typ", hint: "byt / dům / komerční" },
    { key: "price", label: "Cena (Kč)", numeric: true },
    { key: "area_m2", label: "Plocha (m²)", numeric: true },
    { key: "rooms", label: "Pokoje", numeric: true },
    { key: "status", label: "Stav", hint: "aktivní / prodáno / rezervováno" },
    { key: "description", label: "Popis", textarea: true },
    { key: "reconstruction_data", label: "Rekonstrukce", textarea: true },
    { key: "building_modifications", label: "Stavební úpravy", textarea: true },
  ],
  leads: [
    { key: "client_id", label: "Klient (id)", numeric: true },
    { key: "property_id", label: "Nemovitost (id)", numeric: true },
    { key: "status", label: "Stav", hint: "nový / kontaktován / prohlídka / nabídka / uzavřen" },
    { key: "source", label: "Zdroj" },
    { key: "last_contact_at", label: "Posl. kontakt" },
    { key: "next_action", label: "Další krok" },
    { key: "estimated_commission", label: "Odhad provize", numeric: true },
  ],
  transactions: [
    { key: "property_id", label: "Nemovitost (id)", numeric: true },
    { key: "client_id", label: "Klient (id)", numeric: true },
    { key: "sale_price", label: "Prodejní cena", numeric: true },
    { key: "commission", label: "Provize", numeric: true },
    { key: "transaction_date", label: "Datum (YYYY-MM-DD)" },
  ],
  calendar: [
    { key: "title", label: "Název" },
    { key: "start_time", label: "Začátek" },
    { key: "end_time", label: "Konec" },
    { key: "type", label: "Typ", hint: "prohlídka / meeting / hovor / jiné" },
    { key: "location", label: "Místo" },
    { key: "notes", label: "Poznámky", textarea: true },
    { key: "client_id", label: "Klient (id)", numeric: true },
    { key: "property_id", label: "Nemovitost (id)", numeric: true },
  ],
};

const LIST_COLUMNS: Record<TableKey, Array<{ key: string; label: string; fmt?: (v: unknown) => string }>> = {
  clients: [
    { key: "id", label: "#" },
    { key: "name", label: "Jméno" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Telefon" },
    { key: "source", label: "Zdroj" },
  ],
  properties: [
    { key: "id", label: "#" },
    { key: "address", label: "Adresa" },
    { key: "city", label: "Město" },
    { key: "type", label: "Typ" },
    { key: "price", label: "Cena", fmt: (v) => typeof v === "number" ? `${v.toLocaleString("cs-CZ")} Kč` : String(v ?? "") },
    { key: "status", label: "Stav" },
  ],
  leads: [
    { key: "id", label: "#" },
    { key: "client_id", label: "Klient" },
    { key: "property_id", label: "Nemovitost" },
    { key: "status", label: "Stav" },
    { key: "source", label: "Zdroj" },
    { key: "last_contact_at", label: "Posl. kontakt" },
  ],
  transactions: [
    { key: "id", label: "#" },
    { key: "property_id", label: "Nemovitost" },
    { key: "client_id", label: "Klient" },
    { key: "sale_price", label: "Cena", fmt: (v) => typeof v === "number" ? `${v.toLocaleString("cs-CZ")} Kč` : String(v ?? "") },
    { key: "commission", label: "Provize", fmt: (v) => typeof v === "number" ? `${v.toLocaleString("cs-CZ")} Kč` : String(v ?? "") },
    { key: "transaction_date", label: "Datum" },
  ],
  calendar: [
    { key: "id", label: "#" },
    { key: "title", label: "Název" },
    { key: "start_time", label: "Začátek" },
    { key: "end_time", label: "Konec" },
    { key: "type", label: "Typ" },
    { key: "location", label: "Místo" },
  ],
};

type ReplacePromptState = { file: File; existingCount: number } | null;

function ImportSection({ table }: { table: TableKey }) {
  const meta = TABLE_META[table];
  const fields = FIELD_DEFS[table];
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<"append" | "replace">("append");
  const [replacePrompt, setReplacePrompt] = useState<ReplacePromptState>(null);

  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [clearBusy, setClearBusy] = useState(false);

  const refreshRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const r = await fetch(meta.apiList, { cache: "no-store" });
      const d = await r.json();
      const list: unknown = d?.[meta.listKey];
      setRecords(Array.isArray(list) ? (list as Array<Record<string, unknown>>) : []);
    } catch {
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, [meta.apiList, meta.listKey]);

  useEffect(() => {
    refreshRecords();
  }, [refreshRecords]);

  const parseFile = async (f: File) => {
    setPreview(null);
    setResult(null);
    setError(null);
    setMapping({});
    setBusy(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        setError("Soubor neobsahuje žádný list.");
        return;
      }
      const ws = wb.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: "",
        raw: false,
        blankrows: false,
      });
      if (raw.length === 0) {
        setError("Soubor neobsahuje žádná data.");
        return;
      }
      const colsSet = new Set<string>();
      const order: string[] = [];
      for (const r of raw) {
        for (const k of Object.keys(r)) {
          if (!colsSet.has(k)) { colsSet.add(k); order.push(k); }
        }
      }
      const p: Preview = { columns: order, sample: raw.slice(0, 5), rows: raw, total: raw.length, sheetName };
      setPreview(p);
      setMapping(autoGuessMapping(p.columns, fields));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | null) => {
    setFile(f);
    if (!f) {
      setPreview(null);
      return;
    }
    if (records.length > 0) {
      // Ukáže dialog — uživatel zvolí append nebo replace
      setReplacePrompt({ file: f, existingCount: records.length });
      return;
    }
    setStrategy("append");
    await parseFile(f);
  };

  const confirmStrategy = async (chosen: "append" | "replace") => {
    const f = replacePrompt?.file;
    setReplacePrompt(null);
    if (!f) return;
    setStrategy(chosen);
    await parseFile(f);
  };

  const doImport = async () => {
    if (!file || !preview) return;
    const requiredUnmapped = fields.filter((f) => f.required).filter((f) => !Object.values(mapping).includes(f.key));
    if (requiredUnmapped.length > 0) {
      setError(`Chybí mapování povinných sloupců: ${requiredUnmapped.map((f) => f.label).join(", ")}.`);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/import/rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: meta.endpointTable,
          mapping,
          rows: preview.rows,
          strategy,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Import selhal.");
      } else {
        setResult({
          total: data.total ?? 0,
          inserted: data.inserted ?? 0,
          skipped: data.skipped ?? 0,
          error_count: data.error_count ?? 0,
          errors: data.errors ?? [],
          warnings: data.warnings ?? [],
          warning_count: data.warning_count ?? 0,
          strategy: data.strategy,
        });
        await refreshRecords();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteRecord = async (id: number) => {
    if (!window.confirm(`Smazat záznam #${id}?`)) return;
    try {
      const res = await fetch(meta.apiItem(id), { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(`Chyba: ${data.error ?? res.status}`);
      } else {
        await refreshRecords();
      }
    } catch (e) {
      alert(`Chyba: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const clearCategory = async () => {
    if (!window.confirm(`Opravdu smazat VŠECHNY záznamy v kategorii „${meta.title}"?\nTato akce je nevratná.`)) return;
    setClearBusy(true);
    try {
      const res = await fetch("/api/data/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "SMAZAT", table: meta.endpointTable }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(`Chyba: ${data.error ?? res.status}`);
      } else {
        await refreshRecords();
      }
    } catch (e) {
      alert(`Chyba: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setClearBusy(false);
    }
  };

  const visibleRecords = showAll ? records : records.slice(0, 10);
  const columns = LIST_COLUMNS[table];

  return (
    <div className="rounded-xl border border-border bg-bg-panel p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">{meta.icon} {meta.title}</h2>
        <a
          href={`/api/import/template?table=${meta.endpointTable}`}
          className="rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-text hover:border-accent"
        >
          ⬇ Stáhnout vzorovou šablonu
        </a>
      </div>

      <div className="mb-3">
        <input
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="block w-full cursor-pointer rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text file:mr-3 file:rounded-md file:border-0 file:bg-bg-panel file:px-3 file:py-1.5 file:text-xs file:text-text hover:file:bg-bg-hover"
        />
        <p className="mt-1 text-[11px] text-text-dim">
          Podporovány soubory Excel (.xlsx, .xls) a CSV. Parsování probíhá přímo v prohlížeči.
        </p>
      </div>

      {busy && <div className="mb-2 text-xs text-text-dim">…zpracovávám</div>}
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {replacePrompt && (
        <div className="mb-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-xs text-yellow-100">
          <div className="mb-2 font-medium">
            V kategorii je {replacePrompt.existingCount} existujících záznamů. Chcete nové přidat, nebo všechny nahradit?
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => confirmStrategy("append")}
              className="rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-text hover:border-accent"
            >
              ➕ Přidat k existujícím
            </button>
            <button
              onClick={() => confirmStrategy("replace")}
              className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20"
            >
              🔄 Nahradit všechna data
            </button>
            <button
              onClick={() => { setReplacePrompt(null); setFile(null); }}
              className="rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-text-dim hover:border-accent"
            >
              Zrušit
            </button>
          </div>
        </div>
      )}

      {preview && (
        <>
          <div className="mb-3 flex items-center justify-between gap-2 text-xs text-text-dim">
            <div>
              Detekováno <strong className="text-text">{preview.total}</strong> záznamů v listu{" "}
              <code className="rounded bg-bg px-1">{preview.sheetName}</code>.
            </div>
            <div className="rounded px-2 py-0.5 text-[11px]"
              style={{ background: strategy === "replace" ? "rgba(239,68,68,0.15)" : "rgba(59,130,246,0.15)", color: strategy === "replace" ? "#fca5a5" : "#93c5fd" }}>
              Režim: {strategy === "replace" ? "nahradit vše" : "přidat"}
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-dim">
              Mapování sloupců
            </div>
            <div className="space-y-2">
              {preview.columns.map((col) => (
                <div key={col} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-text">
                    <span className="text-text-dim">Soubor:</span> <strong>{col}</strong>
                  </div>
                  <span className="text-text-dim">→</span>
                  <select
                    value={mapping[col] ?? ""}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [col]: e.target.value }))}
                    className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-text focus:border-accent focus:outline-none"
                  >
                    <option value="">— ignorovat —</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-dim">
              Náhled (prvních {Math.min(5, preview.sample.length)} řádků)
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full text-[11px]">
                <thead className="bg-bg-sidebar">
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c} className="border-b border-border px-2 py-1 text-left text-text-dim">
                        {c}
                        {mapping[c] && <span className="ml-1 text-[10px] text-accent">→ {mapping[c]}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((r, i) => (
                    <tr key={i} className="odd:bg-bg-sidebar/40">
                      {preview.columns.map((c) => (
                        <td key={c} className="border-b border-border px-2 py-1 text-text">
                          {r[c] === null || r[c] === undefined ? "" : String(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={doImport}
              disabled={busy}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Importovat {preview.total} záznamů
            </button>
            <div className="text-[11px] text-text-dim">
              Povinné pole <span className="text-accent">*</span> musí mít namapovaný sloupec.
            </div>
          </div>
        </>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-xs text-green-300">
          <div className="font-medium">
            ✓ Importováno {result.inserted} záznamů
            {result.skipped > 0 && ` · ${result.skipped} přeskočeno (duplicity)`}
            {result.error_count - result.skipped > 0 && ` · ${result.error_count - result.skipped} chyb`}
            {result.strategy === "replace" && ` · původní data nahrazena`}
            .
          </div>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-text-dim">Ukázat chyby ({result.errors.length})</summary>
              <ul className="mt-2 space-y-0.5">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-text-dim">Řádek {e.row}: {e.error}</li>
                ))}
              </ul>
            </details>
          )}
          {result.warnings && result.warnings.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-amber-300">
                Upozornění: {result.warning_count ?? result.warnings.length} záznamů bez vazby
              </summary>
              <ul className="mt-2 space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-amber-200/80">Řádek {w.row}: {w.warning}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Správa importovaných dat */}
      <div className="mt-6 border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium text-text">
            Aktuálně v databázi: <strong className="text-text">{records.length}</strong> záznamů
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshRecords}
              disabled={recordsLoading}
              className="rounded-lg border border-border bg-bg px-2 py-1 text-[11px] text-text-dim hover:border-accent disabled:opacity-50"
            >
              {recordsLoading ? "…" : "↻ Obnovit"}
            </button>
            {records.length > 0 && (
              <button
                onClick={clearCategory}
                disabled={clearBusy}
                className="rounded-lg border border-red-500/50 bg-red-500/10 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/20 disabled:opacity-50"
              >
                🗑 Smazat vše v této kategorii
              </button>
            )}
          </div>
        </div>

        {records.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-bg/30 p-4 text-center text-[11px] text-text-dim">
            Žádné záznamy. Nahrajte soubor výše pro přidání dat.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full text-[11px]">
                <thead className="bg-bg-sidebar">
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key} className="border-b border-border px-2 py-1 text-left text-text-dim">
                        {c.label}
                      </th>
                    ))}
                    <th className="border-b border-border px-2 py-1 text-right text-text-dim">Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map((r, i) => (
                    <tr
                      key={Number(r.id) ?? i}
                      className="cursor-pointer odd:bg-bg-sidebar/40 hover:bg-accent/10"
                      onClick={() => setEditing(r)}
                    >
                      {columns.map((c) => {
                        const v = r[c.key];
                        const display = c.fmt ? c.fmt(v) : v === null || v === undefined ? "" : String(v);
                        return (
                          <td key={c.key} className="border-b border-border px-2 py-1 text-text">
                            {display}
                          </td>
                        );
                      })}
                      <td className="border-b border-border px-2 py-1 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteRecord(Number(r.id)); }}
                          className="rounded border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-500/20"
                        >
                          Smazat
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {records.length > 10 && (
              <div className="mt-2 text-center">
                <button
                  onClick={() => setShowAll((s) => !s)}
                  className="text-[11px] text-accent hover:underline"
                >
                  {showAll ? `↑ Skrýt (zobrazeno ${records.length})` : `↓ Zobrazit vše (${records.length})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {editing && (
        <EditModal
          table={table}
          record={editing}
          onClose={() => setEditing(null)}
          onSaved={refreshRecords}
        />
      )}
    </div>
  );
}

export default function ImportPage() {
  const [mode, setMode] = useState<"prod" | "test">("prod");
  const [modeBusy, setModeBusy] = useState(false);
  const [modeMsg, setModeMsg] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  const refreshMode = useCallback(async () => {
    try {
      const r = await fetch("/api/mode", { cache: "no-store" });
      const d = await r.json();
      if (d?.ok) {
        setMode(d.mode);
        try { localStorage.setItem("realitka-mode", d.mode); } catch {}
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const cached = localStorage.getItem("realitka-mode");
      if (cached === "test" || cached === "prod") setMode(cached);
    } catch {}
    refreshMode();
  }, [refreshMode]);

  const modeAction = async (action: "enter_test" | "exit_test_discard" | "exit_test_commit") => {
    setModeBusy(true);
    setModeMsg(null);
    try {
      const r = await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setModeMsg(`Chyba: ${d.error ?? r.status}`);
      } else {
        setMode(d.mode);
        try { localStorage.setItem("realitka-mode", d.mode); } catch {}
        if (action === "enter_test") setModeMsg("✓ Testovací prostředí vytvořeno (test_ tabulky v Turso).");
        if (action === "exit_test_discard") setModeMsg("✓ Test ukončen, test_ tabulky smazány.");
        if (action === "exit_test_commit") setModeMsg("✓ Testovací data nahradila produkční.");
      }
    } catch (e) {
      setModeMsg(`Síťová chyba: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setModeBusy(false);
    }
  };

  const doReset = async () => {
    const ok1 = window.confirm(
      "Opravdu chcete smazat všechna data (klienty, nemovitosti, leady, transakce, kalendář)? Tato akce je nevratná.",
    );
    if (!ok1) return;
    const typed = window.prompt("Napište SMAZAT pro potvrzení:");
    if (typed !== "SMAZAT") {
      setResetMsg("Zrušeno.");
      return;
    }
    setResetBusy(true);
    setResetMsg("Mažu…");
    try {
      const r = await fetch("/api/data/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "SMAZAT" }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setResetMsg(
          `✓ Smazáno: klienti=${d.cleared.clients}, nemovitosti=${d.cleared.properties}, leady=${d.cleared.leads}, transakce=${d.cleared.transactions}, kalendář=${d.cleared.calendar_events ?? 0}.`,
        );
      } else {
        setResetMsg(`Chyba: ${d.error ?? r.status}`);
      }
    } catch (e) {
      setResetMsg(`Síťová chyba: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResetBusy(false);
    }
  };

  const doSeed = async () => {
    const ok = window.confirm(
      "Naplnit databázi demo daty? Přepíše všechny existující záznamy (50 klientů, 100 nemovitostí, 200 leadů, 30 transakcí).",
    );
    if (!ok) return;
    setSeedBusy(true);
    setSeedMsg("Plním…");
    try {
      const r = await fetch("/api/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "SEED" }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setSeedMsg(
          `✓ Naplněno: klienti=${d.counts.clients}, nemovitosti=${d.counts.properties}, leady=${d.counts.leads}, transakce=${d.counts.transactions}, kalendář=${d.counts.calendar_events ?? 0}.`,
        );
      } else {
        setSeedMsg(`Chyba: ${d.error ?? r.status}`);
      }
    } catch (e) {
      setSeedMsg(`Síťová chyba: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSeedBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg text-text">
      {mode === "test" && (
        <div className="border-b border-yellow-500/40 bg-yellow-500/15 px-6 py-2 text-center text-xs font-medium text-yellow-200">
          🧪 TESTOVACÍ REŽIM — dotazy jdou na test_ tabulky, produkční data nejsou ovlivněna
        </div>
      )}

      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">Import a správa dat</h1>
            <p className="text-xs text-text-dim">
              Nahrát soubory, upravit záznamy nebo přepnout testovací režim.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/settings" className="rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text hover:border-accent hover:bg-bg-hover">
              Nastavení
            </Link>
            <Link href="/" className="rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text hover:border-accent hover:bg-bg-hover">
              ← Zpět do chatu
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        {/* Testovací režim */}
        <section className="rounded-xl border border-border bg-bg-sidebar p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">🧪 Testovací režim</h2>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${mode === "test" ? "bg-yellow-500/20 text-yellow-200" : "bg-green-500/15 text-green-300"}`}>
              {mode === "test" ? "aktivní" : "produkční režim"}
            </span>
          </div>
          <p className="mb-3 text-xs text-text-dim">
            Vytvoří v Turso kopii produkčních tabulek pod prefixem <code className="rounded bg-bg px-1">test_</code>
            {" "}(test_clients, test_properties, …). V testovacím režimu všechny zápisy i čtení jdou na tyto tabulky,
            takže si můžete zkoušet změny bez ovlivnění produkčních dat.
          </p>
          {mode === "prod" ? (
            <button
              type="button"
              disabled={modeBusy}
              onClick={() => modeAction("enter_test")}
              className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-200 hover:bg-yellow-500/20 disabled:opacity-50"
            >
              🧪 {modeBusy ? "Vytvářím…" : "Vytvořit testovací prostředí"}
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={modeBusy}
                onClick={() => modeAction("exit_test_discard")}
                className="rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text hover:border-accent disabled:opacity-50"
              >
                ✗ Ukončit test a smazat test_ tabulky
              </button>
              <button
                type="button"
                disabled={modeBusy}
                onClick={async () => {
                  const ok = window.confirm("Opravdu chcete nahradit PRODUKČNÍ data daty z test_ tabulek? Tato akce je nevratná.");
                  if (ok) modeAction("exit_test_commit");
                }}
                className="rounded-lg border border-green-500/50 bg-green-500/10 px-3 py-1.5 text-xs text-green-300 hover:bg-green-500/20 disabled:opacity-50"
              >
                ✓ Potvrdit a nahradit produkční data
              </button>
            </div>
          )}
          {modeMsg && <div className="mt-2 text-[11px] text-text-dim">{modeMsg}</div>}
        </section>

        <ImportSection table="clients" />
        <ImportSection table="properties" />
        <ImportSection table="leads" />
        <ImportSection table="transactions" />
        <ImportSection table="calendar" />

        {/* Demo data */}
        <section className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-5">
          <h2 className="mb-1 text-sm font-semibold text-blue-300">🌱 Naplnit demo daty</h2>
          <p className="mb-3 text-xs text-text-dim">
            Naplní databázi 50 klienty, 100 nemovitostmi, 200 leady a 30 transakcemi pro demonstrační účely.
            Databáze se nikdy neseeduje automaticky — prázdný stav je validní.
          </p>
          <button
            type="button"
            disabled={seedBusy}
            onClick={doSeed}
            className="rounded-lg border border-blue-500/50 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
          >
            {seedBusy ? "Plním…" : "Naplnit demo daty"}
          </button>
          {seedMsg && (
            <div className={`mt-2 text-[11px] ${seedMsg.startsWith("✓") ? "text-green-400" : "text-text-dim"}`}>
              {seedMsg}
            </div>
          )}
        </section>

        {/* Reset všech dat */}
        <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
          <h2 className="mb-1 text-sm font-semibold text-red-300">🗑️ Reset databáze</h2>
          <p className="mb-3 text-xs text-text-dim">
            Smaže všechna data — klienty, nemovitosti, leady, transakce i kalendář. Použijte před ostrým nasazením.
          </p>
          <button
            type="button"
            disabled={resetBusy}
            onClick={doReset}
            className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          >
            Smazat všechna demo data a začít s čistou databází
          </button>
          {resetMsg && (
            <div className={`mt-2 text-[11px] ${resetMsg.startsWith("✓") ? "text-green-400" : "text-text-dim"}`}>
              {resetMsg}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
