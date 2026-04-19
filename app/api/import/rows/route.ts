import { NextResponse } from "next/server";
import { ensureLocalReady } from "@/lib/db";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLES = ["clients", "properties", "leads", "transactions"] as const;
type TableName = typeof TABLES[number];

const TOOL_BY_TABLE: Record<TableName, string> = {
  clients: "add_client",
  properties: "add_property",
  leads: "add_lead",
  transactions: "add_transaction",
};

const NUMERIC_FIELDS: Record<TableName, string[]> = {
  clients: ["budget_min", "budget_max"],
  properties: ["price", "area_m2", "rooms"],
  leads: ["client_id", "property_id", "estimated_commission"],
  transactions: ["property_id", "client_id", "sale_price", "commission"],
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

export async function POST(req: Request) {
  await ensureLocalReady();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatný JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Neplatný požadavek." }, { status: 400 });
  }
  const { table: tableRaw, mapping, rows } = body as {
    table?: string;
    mapping?: Record<string, string>;
    rows?: Array<Record<string, unknown>>;
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

  let inserted = 0;
  let skipped = 0;
  const errors: Array<{ row: number; error: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    const mapped = applyMapping(rows[i], mapping);
    const input = coerceForTable(table, mapped);
    const res = await runTool(TOOL_BY_TABLE[table], input);
    if (res.ok) {
      inserted++;
    } else {
      const err = res.error ?? "neznámá chyba";
      if (/UNIQUE|duplic/i.test(err)) skipped++;
      errors.push({ row: i + 2, error: err });
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
  });
}
