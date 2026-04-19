"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type TableKey = "clients" | "properties" | "leads";

type DbField = { key: string; label: string; required?: boolean; hint?: string };

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
};

const TABLE_META: Record<TableKey, { title: string; icon: string; endpointTable: string }> = {
  clients:    { title: "Import klientů",     icon: "👥", endpointTable: "clients" },
  properties: { title: "Import nemovitostí", icon: "🏠", endpointTable: "properties" },
  leads:      { title: "Import leadů",       icon: "📊", endpointTable: "leads" },
};

type Preview = {
  columns: string[];
  sample: Array<Record<string, string>>;
  total: number;
  delimiter: string;
};

type CommitResult = {
  total: number;
  inserted: number;
  skipped: number;
  error_count: number;
  errors: Array<{ row: number; error: string }>;
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

function ImportSection({ table }: { table: TableKey }) {
  const meta = TABLE_META[table];
  const fields = FIELD_DEFS[table];
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (f: File | null) => {
    setFile(f);
    setPreview(null);
    setResult(null);
    setError(null);
    setMapping({});
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("table", meta.endpointTable);
      fd.append("mode", "preview");
      fd.append("file", f);
      const res = await fetch("/api/import/csv", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Nepodařilo se načíst soubor.");
      } else {
        const p: Preview = {
          columns: data.columns ?? [],
          sample: data.sample ?? [],
          total: data.total ?? 0,
          delimiter: data.delimiter ?? ",",
        };
        setPreview(p);
        setMapping(autoGuessMapping(p.columns, fields));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
      const fd = new FormData();
      fd.append("table", meta.endpointTable);
      fd.append("mode", "commit");
      fd.append("file", file);
      fd.append("mapping", JSON.stringify(mapping));
      const res = await fetch("/api/import/csv", { method: "POST", body: fd });
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
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-bg-panel p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">
          {meta.icon} {meta.title}
        </h2>
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
          accept=".csv,.tsv,.txt,text/csv"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="block w-full cursor-pointer rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text file:mr-3 file:rounded-md file:border-0 file:bg-bg-panel file:px-3 file:py-1.5 file:text-xs file:text-text hover:file:bg-bg-hover"
        />
        <p className="mt-1 text-[11px] text-text-dim">
          Podporovány soubory CSV (oddělovač čárka/středník/tab). Excel: uložit jako „CSV UTF-8".
        </p>
      </div>

      {busy && <div className="text-xs text-text-dim">…zpracovávám</div>}
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {preview && (
        <>
          <div className="mb-3 text-xs text-text-dim">
            Detekováno <strong className="text-text">{preview.total}</strong> záznamů, oddělovač{" "}
            <code className="rounded bg-bg px-1">{preview.delimiter}</code>.
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
              Náhled (první 3 řádky)
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full text-[11px]">
                <thead className="bg-bg-sidebar">
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c} className="border-b border-border px-2 py-1 text-left text-text-dim">
                        {c}
                        {mapping[c] && (
                          <span className="ml-1 text-[10px] text-accent">→ {mapping[c]}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.slice(0, 3).map((r, i) => (
                    <tr key={i} className="odd:bg-bg-sidebar/40">
                      {preview.columns.map((c) => (
                        <td key={c} className="border-b border-border px-2 py-1 text-text">
                          {r[c] ?? ""}
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
              Povinné pole označené <span className="text-accent">*</span> musí mít namapovaný sloupec.
            </div>
          </div>
        </>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-xs text-green-300">
          <div className="font-medium">
            ✓ Úspěšně importováno {result.inserted} záznamů
            {result.skipped > 0 && ` · ${result.skipped} přeskočeno (duplicity)`}
            {result.error_count - result.skipped > 0 &&
              ` · ${result.error_count - result.skipped} chyb`}
            .
          </div>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-text-dim">
                Ukázat chyby ({result.errors.length})
              </summary>
              <ul className="mt-2 space-y-0.5">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-text-dim">
                    Řádek {e.row}: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
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

  const refreshMode = useCallback(async () => {
    try {
      const r = await fetch("/api/mode");
      const d = await r.json();
      if (d?.ok) setMode(d.mode);
    } catch {}
  }, []);

  useEffect(() => {
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
        if (action === "enter_test") setModeMsg("✓ Testovací prostředí vytvořeno.");
        if (action === "exit_test_discard") setModeMsg("✓ Test ukončen, změny zahozeny.");
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

  return (
    <div className="min-h-screen bg-bg text-text">
      {mode === "test" && (
        <div className="border-b border-yellow-500/40 bg-yellow-500/15 px-6 py-2 text-center text-xs font-medium text-yellow-200">
          🧪 TESTOVACÍ REŽIM — změny neovlivní produkční data
        </div>
      )}

      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">Import dat</h1>
            <p className="text-xs text-text-dim">
              Nahrát reálná data z CSV, vytvořit testovací prostředí nebo smazat demo data.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/settings"
              className="rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text hover:border-accent hover:bg-bg-hover"
            >
              Nastavení
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text hover:border-accent hover:bg-bg-hover"
            >
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
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                mode === "test" ? "bg-yellow-500/20 text-yellow-200" : "bg-green-500/15 text-green-300"
              }`}
            >
              {mode === "test" ? "aktivní" : "produkční režim"}
            </span>
          </div>
          <p className="mb-3 text-xs text-text-dim">
            Vytvoří kopii aktuální databáze pod <code className="rounded bg-bg px-1">test_database.db</code>.
            V testovacím režimu můžete nahrávat soubory a přidávat záznamy přes chat bez ovlivnění produkčních dat.
          </p>
          {mode === "prod" ? (
            <button
              type="button"
              disabled={modeBusy}
              onClick={() => modeAction("enter_test")}
              className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-200 hover:bg-yellow-500/20 disabled:opacity-50"
            >
              🧪 Vytvořit testovací prostředí
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={modeBusy}
                onClick={() => modeAction("exit_test_discard")}
                className="rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text hover:border-accent disabled:opacity-50"
              >
                ✗ Ukončit test a zahodit změny
              </button>
              <button
                type="button"
                disabled={modeBusy}
                onClick={async () => {
                  const ok = window.confirm(
                    "Opravdu chcete nahradit PRODUKČNÍ data testovací databází? Tato akce je nevratná.",
                  );
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

        {/* Reset demo dat */}
        <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
          <h2 className="mb-1 text-sm font-semibold text-red-300">🗑️ Reset databáze</h2>
          <p className="mb-3 text-xs text-text-dim">
            Smaže všechna data — klienty, nemovitosti, leady, transakce i kalendář. Použijte před
            ostrým nasazením, abyste začínali s čistou databází.
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
