import { NextResponse } from "next/server";
import { getDb, dbRun, dbExec, ensureLocalReady } from "@/lib/db";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLES = ["clients", "properties", "leads", "transactions", "calendar_events"] as const;
type TableName = typeof TABLES[number];

const TOOL_BY_TABLE: Partial<Record<TableName, string>> = {
  clients: "add_client",
  properties: "add_property",
  leads: "add_lead",
  transactions: "add_transaction",
  // calendar_events inserujeme přímo (žádný jednoduchý import tool).
};

const NUMERIC_FIELDS: Record<TableName, string[]> = {
  clients: ["budget_min", "budget_max"],
  properties: ["price", "area_m2", "rooms"],
  leads: ["client_id", "property_id", "estimated_commission"],
  transactions: ["property_id", "client_id", "sale_price", "commission"],
  calendar_events: ["client_id", "property_id"],
};

function applyMapping(
  row: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [src, dst] of Object.entries(mapping)) {
    if (!dst) continue;
    if (row[src] !== undefined && row[src] !== null && row[src] !== "") {
      out[dst] = row[src];
    }
  }
  return out;
}

function coerceForTable(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const nums = new Set(NUMERIC_FIELDS[table]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === "" || v === undefined || v === null) continue;
    if (nums.has(k)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = v;
      } else {
        const cleaned = String(v).replace(/\s/g, "").replace(/,/g, ".");
        const n = Number(cleaned);
        if (Number.isFinite(n)) out[k] = n;
      }
    } else {
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}

async function insertCalendarEvent(row: Record<string, unknown>) {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const start_time = typeof row.start_time === "string" ? row.start_time.trim() : "";
  const end_time = typeof row.end_time === "string" ? row.end_time.trim() : "";
  const type = typeof row.type === "string" ? row.type : "meeting";
  if (!title || !start_time || !end_time) {
    throw new Error("Chybí title / start_time / end_time.");
  }
  await dbRun(
    `INSERT INTO calendar_events (title, client_id, property_id, start_time, end_time, type, location, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      typeof row.client_id === "number" ? row.client_id : null,
      typeof row.property_id === "number" ? row.property_id : null,
      start_time,
      end_time,
      type,
      typeof row.location === "string" ? row.location : null,
      typeof row.notes === "string" ? row.notes : null,
      new Date().toISOString().slice(0, 19).replace("T", " "),
    ],
  );
}

async function clearTable(table: TableName): Promise<void> {
  if (table === "clients") {
    await dbExec(`DELETE FROM transactions; DELETE FROM leads; DELETE FROM clients;`);
  } else if (table === "properties") {
    await dbExec(`DELETE FROM transactions; DELETE FROM leads; DELETE FROM properties;`);
  } else {
    await dbExec(`DELETE FROM ${table};`);
  }
  await dbExec(`DELETE FROM sqlite_sequence WHERE name = '${table}';`);
}

export async function POST(req: Request) {
  await ensureLocalReady();
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Neplatný JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }
  const { table: tableRaw, mapping, rows, strategy } = body as {
    table?: string;
    mapping?: Record<string, string>;
    rows?: Array<Record<string, unknown>>;
    strategy?: "append" | "replace";
  };
  if (!tableRaw || !TABLES.includes(tableRaw as TableName)) {
    return NextResponse.json({ ok: false, error: `table musí být ${TABLES.join("/")}.` }, { status: 400 });
  }
  if (!mapping || typeof mapping !== "object") {
    return NextResponse.json({ ok: false, error: "Chybí mapping." }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ ok: false, error: "Žádné řádky k importu." }, { status: 400 });
  }
  const table = tableRaw as TableName;

  if (strategy === "replace") {
    try {
      await clearTable(table);
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  let inserted = 0;
  let skipped = 0;
  const errors: Array<{ row: number; error: string }> = [];
  const toolName = TOOL_BY_TABLE[table];

  for (let i = 0; i < rows.length; i++) {
    const mapped = applyMapping(rows[i], mapping);
    const input = coerceForTable(table, mapped);
    try {
      if (toolName) {
        const res = await runTool(toolName, input);
        if (res.ok) {
          inserted++;
        } else {
          const err = res.error ?? "neznámá chyba";
          if (/UNIQUE|duplic/i.test(err)) skipped++;
          errors.push({ row: i + 2, error: err });
        }
      } else if (table === "calendar_events") {
        await insertCalendarEvent(input);
        inserted++;
      }
    } catch (e) {
      errors.push({ row: i + 2, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    table,
    total: rows.length,
    inserted,
    skipped,
    errors: errors.slice(0, 20),
    error_count: errors.length,
    strategy: strategy ?? "append",
  });
}
