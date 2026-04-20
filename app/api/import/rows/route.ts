import { NextResponse } from "next/server";
import { dbRun, dbExec, dbGet, ensureLocalReady } from "@/lib/db";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLES = ["clients", "properties", "leads", "transactions", "calendar_events"] as const;
type TableName = typeof TABLES[number];

// Leads, transactions a calendar_events řešíme vlastními handlery
// (partial match + null FK fallback — nikdy neshazujeme řádek kvůli chybějící vazbě).
const TOOL_BY_TABLE: Partial<Record<TableName, string>> = {
  clients: "add_client",
  properties: "add_property",
};

const NUMERIC_FIELDS: Record<TableName, string[]> = {
  clients: ["budget_min", "budget_max"],
  properties: ["price", "area_m2", "rooms"],
  leads: ["client_id", "property_id", "estimated_commission"],
  transactions: ["property_id", "client_id", "sale_price", "commission"],
  calendar_events: ["client_id", "property_id"],
};

const CALENDAR_TYPES = ["prohlídka", "meeting", "hovor", "jiné"] as const;

// Přijme string v YYYY-MM-DD, DD.MM.YYYY, D/M/YYYY i ISO timestamp; vrátí YYYY-MM-DD nebo null.
function normalizeDate(input: unknown): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  // ISO (může obsahovat čas): 2026-04-20[T ...]
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const y = m[1], mo = m[2].padStart(2, "0"), d = m[3].padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  // DD.MM.YYYY nebo DD. MM. YYYY
  m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (m) {
    const d = m[1].padStart(2, "0"), mo = m[2].padStart(2, "0"), y = m[3];
    return `${y}-${mo}-${d}`;
  }
  // DD/MM/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const d = m[1].padStart(2, "0"), mo = m[2].padStart(2, "0"), y = m[3];
    return `${y}-${mo}-${d}`;
  }
  // Fallback: zkusit Date parser
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${dd}`;
  }
  return null;
}

// Přijme "9:00", "09:00", "09:00:00", "9h", "9.00" → "HH:MM" nebo null.
function normalizeTime(input: unknown): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[:.hH](\d{1,2})/);
  if (m) {
    const h = Math.min(23, parseInt(m[1], 10));
    const mi = Math.min(59, parseInt(m[2], 10));
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  const onlyH = s.match(/^(\d{1,2})\s*h?$/);
  if (onlyH) {
    const h = Math.min(23, parseInt(onlyH[1], 10));
    return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

function addHour(hhmm: string): string {
  const [h, mi] = hhmm.split(":").map((x) => parseInt(x, 10));
  const next = (h + 1) % 24;
  return `${String(next).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

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

type CalInsertResult = { ok: true; warnings: string[] } | { ok: false; error: string };

async function insertCalendarEvent(row: Record<string, unknown>): Promise<CalInsertResult> {
  const warnings: string[] = [];
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (!title) return { ok: false, error: "Chybí název události (title)." };

  // 1) start_time: preferuj explicitní start_time; jinak slož datum + čas od (default 09:00).
  let start_time = "";
  if (typeof row.start_time === "string" && row.start_time.trim()) {
    const raw = row.start_time.trim();
    const d = normalizeDate(raw);
    const tMatch = raw.match(/(\d{1,2}[:.hH]\d{1,2})/);
    const t = tMatch ? normalizeTime(tMatch[1]) : null;
    if (d) start_time = `${d} ${t ?? "09:00"}`;
    else start_time = raw; // fallback — necháme beze změny
  }
  if (!start_time) {
    const d = normalizeDate(row.date);
    if (!d) return { ok: false, error: "Chybí datum — povinné pole." };
    const t = normalizeTime(row.time_from) ?? "09:00";
    start_time = `${d} ${t}`;
  }

  // 2) end_time: explicitní, jinak datum + čas do (default start + 1h).
  let end_time = "";
  if (typeof row.end_time === "string" && row.end_time.trim()) {
    const raw = row.end_time.trim();
    const d = normalizeDate(raw);
    const tMatch = raw.match(/(\d{1,2}[:.hH]\d{1,2})/);
    const t = tMatch ? normalizeTime(tMatch[1]) : null;
    if (d) end_time = `${d} ${t ?? addHour(start_time.slice(11, 16) || "09:00")}`;
    else end_time = raw;
  }
  if (!end_time) {
    const dateForEnd = normalizeDate(row.date) ?? start_time.slice(0, 10);
    const startHm = start_time.slice(11, 16) || "09:00";
    const t = normalizeTime(row.time_to) ?? addHour(startHm);
    end_time = `${dateForEnd} ${t}`;
  }

  // 3) type: musí být z allowed setu; jinak default "meeting" s upozorněním.
  const typeRaw = typeof row.type === "string" ? row.type.trim().toLowerCase() : "";
  let type: string = "meeting";
  if (typeRaw) {
    const hit = CALENDAR_TYPES.find((t) => t.toLowerCase() === typeRaw);
    if (hit) type = hit;
    else warnings.push(`Neznámý typ "${row.type}" — použit default "meeting"`);
  }

  // 4) client_id / property_id: číselná vazba vyhraje; jinak LIKE podle client_name / property_address.
  const clientId = await resolveClientId(row);
  if (clientId === null && hasClientHint(row)) {
    warnings.push("Klient nepárován, událost importována bez vazby");
  }
  const propertyId = await resolveProperty(row);
  if (propertyId === null && hasPropertyHint(row)) {
    warnings.push("Nemovitost nepárována, událost importována bez vazby");
  }

  try {
    await dbRun(
      `INSERT INTO calendar_events (title, client_id, property_id, start_time, end_time, type, location, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        clientId,
        propertyId,
        start_time,
        end_time,
        type,
        typeof row.location === "string" ? row.location : null,
        typeof row.notes === "string" ? row.notes : null,
        new Date().toISOString().slice(0, 19).replace("T", " "),
      ],
    );
    return { ok: true, warnings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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

// "Úvoz 33, Brno" → "Úvoz 33"; "Komunardů 30, Praha 7" → "Komunardů 30".
// Odstraní všechny segmenty oddělené čárkou kromě prvního.
function extractStreetAndNumber(addr: string): string {
  return addr.split(",")[0].trim();
}

// Ze "street and number" vytáhni zvlášť první slovo (ulice) a první číslo,
// abychom mohli hledat i 'ulice%číslo' (tolerance k mezeře/pomlčce).
function splitStreetNumber(s: string): { street: string; number: string } | null {
  const m = s.match(/^(.+?)\s*(\d+[a-zA-Z]?)\s*$/);
  if (!m) return null;
  return { street: m[1].trim(), number: m[2].trim() };
}

// "Extern — Filip Král" → "Král" (poslední slovo s délkou ≥ 3).
// Cílem je najít klienta podle příjmení, i když ostatní tokeny jsou navíc.
function extractSurname(name: string): string {
  const tokens = name.replace(/[—–-]/g, " ").split(/\s+/).filter((t) => t.length >= 3);
  return tokens[tokens.length - 1] ?? "";
}

async function resolveClientId(row: Record<string, unknown>): Promise<number | null> {
  if (typeof row.client_id === "number" && Number.isFinite(row.client_id)) {
    const hit = await dbGet<{ id: number }>(`SELECT id FROM clients WHERE id = ?`, [row.client_id]);
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
  const name = typeof row.client_name === "string" ? row.client_name.trim() : "";
  if (name) {
    // 1) Plná shoda jména přes LIKE.
    const full = await dbGet<{ id: number }>(
      `SELECT id FROM clients WHERE name LIKE ? ORDER BY created_at DESC LIMIT 1`,
      [`%${name}%`],
    );
    if (full) return full.id;
    // 2) Fallback: jen příjmení.
    const surname = extractSurname(name);
    if (surname && surname.toLowerCase() !== name.toLowerCase()) {
      const bySurname = await dbGet<{ id: number }>(
        `SELECT id FROM clients WHERE name LIKE ? ORDER BY created_at DESC LIMIT 1`,
        [`%${surname}%`],
      );
      if (bySurname) return bySurname.id;
    }
  }
  return null;
}

async function resolveProperty(row: Record<string, unknown>): Promise<number | null> {
  if (typeof row.property_id === "number" && Number.isFinite(row.property_id)) {
    const hit = await dbGet<{ id: number }>(`SELECT id FROM properties WHERE id = ?`, [row.property_id]);
    if (hit) return hit.id;
  }
  const addr = typeof row.property_address === "string" ? row.property_address.trim() : "";
  if (!addr) return null;

  // 1) Ulice + číslo (bez města). Nejspolehlivější varianta — "Úvoz 33, Brno" → "Úvoz 33".
  const streetAndNumber = extractStreetAndNumber(addr);
  if (streetAndNumber) {
    const hit = await dbGet<{ id: number }>(
      `SELECT id FROM properties WHERE address LIKE ? ORDER BY created_at DESC LIMIT 1`,
      [`%${streetAndNumber}%`],
    );
    if (hit) return hit.id;
  }

  // 2) 'ulice%číslo' — tolerance k "Úvoz  33" vs "Úvoz 33" (víc mezer, pomlčka).
  const parts = splitStreetNumber(streetAndNumber);
  if (parts) {
    const hit = await dbGet<{ id: number }>(
      `SELECT id FROM properties WHERE address LIKE ? ORDER BY created_at DESC LIMIT 1`,
      [`%${parts.street}%${parts.number}%`],
    );
    if (hit) return hit.id;
  }

  // 3) Úplný fallback — celá zadaná adresa jako LIKE.
  const full = await dbGet<{ id: number }>(
    `SELECT id FROM properties WHERE address LIKE ? ORDER BY created_at DESC LIMIT 1`,
    [`%${addr}%`],
  );
  if (full) return full.id;

  return null;
}

function hasPropertyHint(row: Record<string, unknown>): boolean {
  return Boolean(
    (typeof row.property_id === "number" && Number.isFinite(row.property_id)) ||
    (typeof row.property_address === "string" && row.property_address.trim()),
  );
}

function hasClientHint(row: Record<string, unknown>): boolean {
  return Boolean(
    (typeof row.client_id === "number" && Number.isFinite(row.client_id)) ||
    (typeof row.client_name === "string" && row.client_name.trim()) ||
    (typeof row.client_email === "string" && row.client_email.trim()) ||
    (typeof row.client_phone === "string" && row.client_phone.trim()),
  );
}

type TxInsertResult = { ok: true; warnings: string[] } | { ok: false; error: string };

async function insertTransaction(row: Record<string, unknown>): Promise<TxInsertResult> {
  const warnings: string[] = [];

  const propertyId = await resolveProperty(row);
  if (propertyId === null && hasPropertyHint(row)) {
    warnings.push("Nemovitost nepárována, transakce importována bez vazby");
  }
  const clientId = await resolveClientId(row);
  if (clientId === null && hasClientHint(row)) {
    warnings.push("Klient nepárován, transakce importována bez vazby");
  }

  // sale_price: chybějící/neplatná → 0 (transakce se importuje, jen s nulovou cenou).
  const salePriceRaw = typeof row.sale_price === "number" && Number.isFinite(row.sale_price)
    ? Math.round(row.sale_price) : NaN;
  const salePrice = Number.isFinite(salePriceRaw) && salePriceRaw > 0 ? salePriceRaw : 0;
  if (salePrice === 0 && hasPropertyHint(row)) {
    warnings.push("sale_price chybí nebo je 0, transakce importována s nulovou cenou");
  }

  // commission: Excel může doručit formuli, prázdno, null, text, NaN nebo záporné číslo.
  // V těch případech dopočítáme 3 % ze sale_price; při sale_price = 0 → 0.
  const commissionRaw = typeof row.commission === "number" && Number.isFinite(row.commission)
    ? Math.round(row.commission) : NaN;
  let commission: number;
  if (!Number.isFinite(commissionRaw) || commissionRaw < 0) {
    commission = salePrice > 0 ? Math.round(salePrice * 0.03) : 0;
    warnings.push(`Provize dopočítána (3 % ze sale_price = ${commission.toLocaleString("cs-CZ")} Kč)`);
  } else {
    commission = commissionRaw;
  }

  const date = typeof row.transaction_date === "string" && row.transaction_date.trim()
    ? row.transaction_date.trim() : new Date().toISOString().slice(0, 10);

  try {
    await dbRun(
      `INSERT INTO transactions (property_id, client_id, sale_price, commission, transaction_date)
       VALUES (?, ?, ?, ?, ?)`,
      [propertyId, clientId, salePrice, commission, date],
    );
    // Side-effekty (property → prodáno, souvisící lead → uzavřen) jen když máme
    // skutečné vazby. Bez nich není co aktualizovat.
    if (propertyId !== null) {
      try { await dbRun(`UPDATE properties SET status = 'prodáno' WHERE id = ?`, [propertyId]); } catch {}
    }
    if (propertyId !== null && clientId !== null) {
      try {
        await dbRun(
          `UPDATE leads SET status = 'uzavřen', last_contact_at = ? WHERE client_id = ? AND property_id = ?`,
          [new Date().toISOString(), clientId, propertyId],
        );
      } catch {}
    }
    return { ok: true, warnings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
      } else if (table === "transactions") {
        const res = await insertTransaction(input);
        if (res.ok) {
          inserted++;
          for (const w of res.warnings) warnings.push({ row: i + 2, warning: w });
        } else {
          errors.push({ row: i + 2, error: res.error });
        }
      } else if (table === "calendar_events") {
        const res = await insertCalendarEvent(input);
        if (res.ok) {
          inserted++;
          for (const w of res.warnings) warnings.push({ row: i + 2, warning: w });
        } else {
          errors.push({ row: i + 2, error: res.error });
        }
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
