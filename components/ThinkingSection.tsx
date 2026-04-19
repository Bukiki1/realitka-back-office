"use client";

import { useEffect, useState } from "react";

export type ToolEvent = {
  id: string;
  name: string;
  input?: unknown;
  resultPreview?: string;
  ok?: boolean;
};

const TOOL_LABELS: Record<string, string> = {
  query_database: "SQL dotaz",
  generate_chart: "Graf",
  find_missing_data: "Kontrola chybějících dat",
  generate_report: "Report",
  search_properties: "Hledání nemovitostí",
  draft_email: "Email klientovi",
  generate_weekly_report: "Týdenní report",
  monitor_listings: "Monitoring inzerátů",
  send_email: "Odeslání emailu",
  view_pipeline: "Pipeline leadů",
  compare_properties: "Porovnání nemovitostí",
  get_recommendations: "Doporučení",
  price_map: "Cenová mapa",
  check_followups: "Follow-up management",
  match_clients_properties: "Párování klient ↔ nemovitost",
  client_briefing: "Briefing klienta",
  price_context: "Cenový kontext",
  add_client: "Přidat klienta",
  update_client: "Upravit klienta",
  delete_client: "Smazat klienta",
  add_property: "Přidat nemovitost",
  update_property: "Upravit nemovitost",
  delete_property: "Smazat nemovitost",
  add_lead: "Přidat lead",
  update_lead: "Upravit lead",
  delete_lead: "Smazat lead",
  add_transaction: "Zapsat transakci",
  import_csv: "Import CSV",
};

function toolDescription(evt: ToolEvent): string | null {
  const input = (evt.input ?? {}) as Record<string, unknown>;
  if (evt.name === "query_database") {
    const sql = typeof input.sql === "string" ? input.sql.trim().replace(/\s+/g, " ") : "";
    return sql.length > 80 ? sql.slice(0, 80) + "…" : sql;
  }
  if (evt.name === "generate_chart") {
    const t = typeof input.title === "string" ? input.title : (typeof input.type === "string" ? input.type : "");
    return t || null;
  }
  if (evt.name === "find_missing_data") {
    return typeof input.field === "string" ? `pole: ${input.field}` : null;
  }
  if (evt.name === "search_properties") {
    const parts: string[] = [];
    if (input.city) parts.push(String(input.city));
    if (input.type) parts.push(String(input.type));
    if (typeof input.max_price === "number") parts.push(`do ${input.max_price.toLocaleString("cs-CZ")} Kč`);
    return parts.join(" · ") || null;
  }
  if (evt.name === "generate_report") {
    return typeof input.title === "string" ? input.title : null;
  }
  if (evt.name === "monitor_listings") {
    const parts: string[] = [];
    if (typeof input.locality === "string") parts.push(input.locality);
    if (typeof input.type === "string") parts.push(String(input.type));
    if (typeof input.property_type === "string") parts.push(String(input.property_type));
    return parts.join(" · ") || null;
  }
  if (evt.name === "send_email") {
    return typeof input.to === "string" ? `→ ${input.to}` : null;
  }
  if (evt.name === "compare_properties") {
    if (Array.isArray(input.property_ids)) return `${input.property_ids.length} ID`;
    if (Array.isArray(input.addresses)) return (input.addresses as string[]).join(" vs. ");
    return null;
  }
  if (evt.name === "price_map") {
    return typeof input.type === "string" ? String(input.type) : null;
  }
  if (evt.name === "check_followups") {
    return typeof input.min_days === "number" ? `od ${input.min_days} dní` : null;
  }
  if (evt.name === "match_clients_properties") {
    if (typeof input.client_id === "number") return `klient #${input.client_id}`;
    if (typeof input.limit === "number") return `limit ${input.limit}`;
    return null;
  }
  if (evt.name === "client_briefing") {
    if (typeof input.name === "string") return input.name;
    if (typeof input.client_id === "number") return `klient #${input.client_id}`;
    return null;
  }
  if (evt.name === "price_context") {
    if (typeof input.address === "string") return input.address;
    if (typeof input.property_id === "number") return `nemovitost #${input.property_id}`;
    return null;
  }
  if (evt.name === "add_client" || evt.name === "update_client") {
    if (typeof input.name === "string") return input.name;
    if (typeof input.name_match === "string") return input.name_match;
    if (typeof input.id === "number") return `id=${input.id}`;
    return null;
  }
  if (evt.name === "delete_client") {
    if (typeof input.name_match === "string") return input.name_match;
    if (typeof input.id === "number") return `id=${input.id}`;
    return null;
  }
  if (evt.name === "add_property" || evt.name === "update_property") {
    if (typeof input.address === "string") return input.address;
    if (typeof input.address_match === "string") return input.address_match;
    if (typeof input.id === "number") return `id=${input.id}`;
    return null;
  }
  if (evt.name === "delete_property") {
    if (typeof input.address_match === "string") return input.address_match;
    if (typeof input.id === "number") return `id=${input.id}`;
    return null;
  }
  if (evt.name === "add_lead") {
    const parts: string[] = [];
    if (typeof input.client_name === "string") parts.push(input.client_name);
    else if (typeof input.client_id === "number") parts.push(`client=${input.client_id}`);
    if (typeof input.property_address === "string") parts.push(input.property_address);
    else if (typeof input.property_id === "number") parts.push(`prop=${input.property_id}`);
    return parts.join(" ↔ ") || null;
  }
  if (evt.name === "update_lead" || evt.name === "delete_lead") {
    if (typeof input.id === "number") return `lead_id=${input.id}`;
    return null;
  }
  if (evt.name === "add_transaction") {
    if (typeof input.sale_price === "number") return `${input.sale_price.toLocaleString("cs-CZ")} Kč`;
    return null;
  }
  if (evt.name === "import_csv") {
    if (typeof input.table === "string") return `tabulka: ${input.table}`;
    return null;
  }
  return null;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StepIcon({ name, running }: { name: string; running: boolean }) {
  if (running) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="animate-spin text-accent">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
        <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  const common = { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none" } as const;
  if (name === "query_database") return (
    <svg {...common} className="text-text-muted"><ellipse cx="12" cy="5" rx="8" ry="3" stroke="currentColor" strokeWidth="1.8" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
  if (name === "generate_chart") return (
    <svg {...common} className="text-text-muted"><path d="M3 3v18h18M7 15l4-4 3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === "find_missing_data") return (
    <svg {...common} className="text-text-muted"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" /><path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
  if (name === "generate_report") return (
    <svg {...common} className="text-text-muted"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === "search_properties") return (
    <svg {...common} className="text-text-muted"><path d="M3 11L12 3l9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V11z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
  );
  if (name === "draft_email") return (
    <svg {...common} className="text-text-muted"><path d="M4 4h16v16H4z M4 4l8 8 8-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === "generate_weekly_report") return (
    <svg {...common} className="text-text-muted"><path d="M4 4h16v12H4z M8 20h8 M12 16v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 12l2-3 2 2 3-4 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === "monitor_listings") return (
    <svg {...common} className="text-text-muted"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" /><path d="M21 21l-4.3-4.3 M8 11h6 M11 8v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
  if (name === "send_email") return (
    <svg {...common} className="text-text-muted"><path d="M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === "view_pipeline") return (
    <svg {...common} className="text-text-muted"><path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
  );
  if (name === "compare_properties") return (
    <svg {...common} className="text-text-muted"><path d="M9 3v18 M15 3v18 M3 9h18 M3 15h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
  if (name === "get_recommendations") return (
    <svg {...common} className="text-text-muted"><path d="M12 2l2.5 6.5L21 10l-5 4.5L17.5 22 12 18.5 6.5 22 8 14.5 3 10l6.5-1.5L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
  );
  if (name === "price_map") return (
    <svg {...common} className="text-text-muted"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z M9 4v13 M15 7v13" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
  );
  if (name === "check_followups") return (
    <svg {...common} className="text-text-muted"><path d="M12 8v4l3 2 M12 2a10 10 0 1 0 10 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
  if (name === "match_clients_properties") return (
    <svg {...common} className="text-text-muted"><path d="M10 13a5 5 0 0 1 7-7l1 1a5 5 0 0 1-7 7 M14 11a5 5 0 0 1-7 7l-1-1a5 5 0 0 1 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
  if (name === "client_briefing") return (
    <svg {...common} className="text-text-muted"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
  if (name === "price_context") return (
    <svg {...common} className="text-text-muted"><path d="M4 20V10M10 20V4M16 20v-6M22 20H2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
  if (name === "add_client" || name === "add_property" || name === "add_lead" || name === "add_transaction") return (
    <svg {...common} className="text-text-muted"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  );
  if (name === "update_client" || name === "update_property" || name === "update_lead") return (
    <svg {...common} className="text-text-muted"><path d="M12 20h9 M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === "delete_client" || name === "delete_property" || name === "delete_lead") return (
    <svg {...common} className="text-text-muted"><path d="M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === "import_csv") return (
    <svg {...common} className="text-text-muted"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  return <span className="h-1.5 w-1.5 rounded-full bg-text-dim" />;
}

function StepRow({ evt }: { evt: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const running = evt.resultPreview === undefined;
  const label = TOOL_LABELS[evt.name] ?? evt.name;
  const desc = toolDescription(evt);
  const hasDetails = evt.input !== undefined || evt.resultPreview !== undefined;

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => hasDetails && setOpen(!open)}
        className={`flex w-full items-start gap-2 py-1.5 text-left transition ${hasDetails ? "hover:text-text" : "cursor-default"}`}
      >
        <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center">
          <StepIcon name={evt.name} running={running} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-[13px] font-medium text-text-muted">{label}</span>
          {desc && (
            <span className="ml-2 truncate text-[12px] text-text-dim">
              {desc}
            </span>
          )}
        </span>
        {hasDetails && (
          <span className="mt-1 text-text-dim opacity-0 transition group-hover:opacity-100">
            <Chevron open={open} />
          </span>
        )}
      </button>

      <div className={`collapsible ${open ? "collapsible-open" : ""}`}>
        <div>
          <div className="ml-6 mb-2 space-y-2 text-[11px]">
            {evt.input !== undefined && (
              <div>
                <div className="mb-1 text-text-dim">Vstup:</div>
                <pre className="overflow-x-auto rounded bg-black/40 p-2 text-text-muted">
{JSON.stringify(evt.input, null, 2)}
                </pre>
              </div>
            )}
            {evt.resultPreview !== undefined && (
              <div>
                <div className="mb-1 text-text-dim">Výsledek:</div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-text-muted">
{evt.resultPreview}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThinkingSection({
  events,
  streaming,
}: {
  events: ToolEvent[];
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [finalSeconds, setFinalSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!streaming) {
      // Uzamkni finální čas, až přestane streamovat.
      setFinalSeconds((prev) => prev ?? seconds);
      return;
    }
    const start = Date.now() - seconds * 1000;
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  const n = events.length;
  const headerLabel = streaming
    ? `Přemýšlím${seconds > 0 ? ` (${seconds}s)` : "…"}`
    : n === 0
      ? "Bez dalších kroků"
      : `Zobrazit postup (${n} ${n === 1 ? "krok" : n < 5 ? "kroky" : "kroků"}${finalSeconds ? ` · ${finalSeconds}s` : ""})`;

  return (
    <div className="thinking-box">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-muted transition hover:text-text"
      >
        {streaming ? (
          <span className="relative grid h-3.5 w-3.5 place-items-center">
            <span className="absolute inline-block h-2 w-2 rounded-full bg-accent animate-ping opacity-75" />
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
        ) : (
          <Chevron open={open} />
        )}
        <span className="flex-1 truncate">{headerLabel}</span>
      </button>

      <div className={`collapsible ${open ? "collapsible-open" : ""}`}>
        <div>
          <div className="px-3 pb-2 pt-0">
            {n === 0 ? (
              <div className="py-1 text-[12px] text-text-dim">Zatím žádné kroky.</div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {events.map((e) => <StepRow key={e.id} evt={e} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
