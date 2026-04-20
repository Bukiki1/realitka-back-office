import { NextResponse } from "next/server";
import { dbRun, dbExec, dbGet, ensureLocalReady } from "@/lib/db";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLES = ["clients", "properties", "leads", "transactions", "calendar_events"] as const;
type TableName = typeof TABLES[number];

// Leads a calendar_events řešíme vlastními handlery (partial match + null FK).
const TOOL_BY_TABLE: Partial<Record<TableName, string>> = {
  clients: "add_client",
  properties: "add_property",
  transactions: "add_transaction",
};

const NUMERIC_FIELDS: Record<TableName, string[]> = {
  clients: ["budget_min", "budget_max"],
  properties: ["price", "area_m2", "rooms"],
  leads: ["client_id", "property_id", "estimated_commission"],
  transactions: ["property_id", "client_id", "sale_price", "commission"],
  calendar_events: ["client_id", "property_id"],
};

const LEAD_STATUSES = ["nový", "kontaktován", "prohlídka", "nabídka", "uzavřen"] as const;

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

// Lead import: LIKE match pro klienta/nemovitost; pokud nenalezeno, zapíše se
// s NULL FK a vrací warning, aby se řádek neztratil.
type LeadInsertResult = { ok: true; warnings: string[] } | { ok: false; error: string };

async function insertLead(row: Record<string, unknown>): Promise<LeadInsertResult> {
  const warnings: string[] = [];

  const clientId = await resolveClientId(row);
  if (clientId === null) warnings.push("Klient nepárován, lead importován bez vazby");

  const propertyId = await resolveProperty(row);
  if (propertyId === null && hasPropertyHint(row)) {
    warnings.push("Nemovitost nepárována, lead importován bez vazby");
  }

  const statusInput = typeof row.status === "string" ? row.status.trim() : "";
  const status = (LEAD_STATUSES as readonly string[]).includes(statusInput) ? statusInput : "nový";
  const source = typeof row.source === "string" && row.source.trim() ? row.source.trim() : "import";

  const now = new Date().toISOString();
  const last_contact_at = typeof row.last_contact_at === "string" && row.last_contact_at.trim()
    ? row.last_contact_at.trim() : now;
  const next_action = typeof row.next_action === "string" ? row.next_action : null;
  const estimated_commission = typeof row.estimated_commission === "number" && Number.isFinite(row.estimated_commission)
    ? row.estimated_commission : null;

  try {
    await dbRun(
      `INSERT INTO leads (client_id, property_id, status, source, created_at, last_contact_at, next_action, estimated_commission)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [clientId, propertyId, status, source, now, last_contact_at, next_action, estimated_commission],
    );
    return { ok: true, warnings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function resolveClientId(row: Record<string, unknown>): Promise<number | null> {
  if (typeof row.client_id === "number" && Number.isFinite(row.client_id)) {
    const hit = await dbGet<{ id: number }>(`SELECT id FROM clients WHERE id = ?`, [row.client_id]);
    if (hit) return hit.id;
  }
  const name = typeof row.client_name === "string" ? row.client_name.trim() : "";
  if (name) {
    const hit = await dbGet<{ id: number }>(
      `SELECT id FROM clients WHERE name LIKE ? ORDER BY created_at DESC LIMIT 1`,
      [`%${name}%`],
    );
    if (hit) return hit.id;
  }
  const email = typeof row.client_email === "string" ? row.client_email.trim() : "";
  if (email) {
    const hit = await dbGet<{ id: number }>(
      `SELECT id FROM clients WHERE email = ? ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    if (hit) return hit.id;
  }
  const phone = typeof row.client_phone === "string" ? row.client_phone.trim() : "";
  if (phone) {
    const hit = await dbGet<{ id: number }>(
      `SELECT id FROM clients WHERE phone = ? ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    if (hit) return hit.id;
  }
  return null;
}

async function resolveProperty(row: Record<string, unknown>): Promise<number | null> {
  if (typeof row.property_id === "number" && Number.isFinite(row.property_id)) {
    const hit = await dbGet<{ id: number }>(`SELECT id FROM properties WHERE id = ?`, [row.property_id]);
    if (hit) return hit.id;
  }
  const addr = typeof row.property_address === "string" ? row.property_address.trim() : "";
  if (addr) {
    const hit = await dbGet<{ id: number }>(
      `SELECT id FROM properties WHERE address LIKE ? ORDER BY created_at DESC LIMIT 1`,
      [`%${addr}%`],
    );
    if (hit) return hit.id;
  }
  return null;
}

function hasPropertyHint(row: Record<string, unknown>): boolean {
  return Boolean(
    (typeof row.property_id === "number" && Number.isFinite(row.property_id)) ||
    (typeof row.property_address === "string" && row.property_address.trim()),
  );
}

async function clearTable(table: TableName): Promise<void> {
  // Závislé záznamy mažeme vždy před nadřazenými. Kalendářní události zachováme
  // a jen u nich vynulujeme client_id / property_id.
  if (table === "clients") {
    await dbExec(
      `DELETE FROM transactions; DELETE FROM leads; UPDATE calendar_events SET client_id = NULL; DELETE FROM clients;`,
    );
  } else if (table === "properties") {
    await dbExec(
      `DELETE FROM transactions; DELETE FROM leads; UPDATE calendar_events SET property_id = NULL; DELETE FROM properties;`,
    );
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
  const warnings: Array<{ row: number; warning: string }> = [];
  const toolName = TOOL_BY_TABLE[table];

  for (let i = 0; i < rows.length; i++) {
    const mapped = applyMapping(rows[i], mapping);
    const input = coerceForTable(table, mapped);
    try {
      if (table === "leads") {
        const res = await insertLead(input);
        if (res.ok) {
          inserted++;
          for (const w of res.warnings) warnings.push({ row: i + 2, warning: w });
        } else {
          errors.push({ row: i + 2, error: res.error });
        }
      } else if (table === "calendar_events") {
        await insertCalendarEvent(input);
        inserted++;
      } else if (toolName) {
        const res = await runTool(toolName, input);
        if (res.ok) {
          inserted++;
        } else {
          const err = res.error ?? "neznámá chyba";
          if (/UNIQUE|duplic/i.test(err)) skipped++;
          errors.push({ row: i + 2, error: err });
        }
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
    warnings: warnings.slice(0, 50),
    warning_count: warnings.length,
    strategy: strategy ?? "append",
  });
}
