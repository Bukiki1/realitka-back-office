import { NextResponse } from "next/server";
import { ensureLocalReady } from "@/lib/db";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Windows-1250 (Střední Evropa) → Unicode mapování pro pozice 0x80–0xFF.
// Node.js nemá nativní decoder pro cp1250, proto děláme ručně.
const CP1250: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x89: "‰", 0x8A: "Š", 0x8B: "‹", 0x8C: "Ś", 0x8D: "Ť", 0x8E: "Ž", 0x8F: "Ź",
  0x91: "'", 0x92: "'", 0x93: "\"", 0x94: "\"", 0x95: "•", 0x96: "–", 0x97: "—",
  0x99: "™", 0x9A: "š", 0x9B: "›", 0x9C: "ś", 0x9D: "ť", 0x9E: "ž", 0x9F: "ź",
  0xA0: " ", 0xA1: "ˇ", 0xA2: "˘", 0xA3: "Ł", 0xA4: "¤", 0xA5: "Ą", 0xA6: "¦",
  0xA7: "§", 0xA8: "¨", 0xA9: "©", 0xAA: "Ş", 0xAB: "«", 0xAC: "¬", 0xAD: "­",
  0xAE: "®", 0xAF: "Ż", 0xB0: "°", 0xB1: "±", 0xB2: "˛", 0xB3: "ł", 0xB4: "´",
  0xB5: "µ", 0xB6: "¶", 0xB7: "·", 0xB8: "¸", 0xB9: "ą", 0xBA: "ş", 0xBB: "»",
  0xBC: "Ľ", 0xBD: "˝", 0xBE: "ľ", 0xBF: "ż", 0xC0: "Ŕ", 0xC1: "Á", 0xC2: "Â",
  0xC3: "Ă", 0xC4: "Ä", 0xC5: "Ĺ", 0xC6: "Ć", 0xC7: "Ç", 0xC8: "Č", 0xC9: "É",
  0xCA: "Ę", 0xCB: "Ë", 0xCC: "Ě", 0xCD: "Í", 0xCE: "Î", 0xCF: "Ď", 0xD0: "Đ",
  0xD1: "Ń", 0xD2: "Ň", 0xD3: "Ó", 0xD4: "Ô", 0xD5: "Ő", 0xD6: "Ö", 0xD7: "×",
  0xD8: "Ř", 0xD9: "Ů", 0xDA: "Ú", 0xDB: "Ű", 0xDC: "Ü", 0xDD: "Ý", 0xDE: "Ţ",
  0xDF: "ß", 0xE0: "ŕ", 0xE1: "á", 0xE2: "â", 0xE3: "ă", 0xE4: "ä", 0xE5: "ĺ",
  0xE6: "ć", 0xE7: "ç", 0xE8: "č", 0xE9: "é", 0xEA: "ę", 0xEB: "ë", 0xEC: "ě",
  0xED: "í", 0xEE: "î", 0xEF: "ď", 0xF0: "đ", 0xF1: "ń", 0xF2: "ň", 0xF3: "ó",
  0xF4: "ô", 0xF5: "ő", 0xF6: "ö", 0xF7: "÷", 0xF8: "ř", 0xF9: "ů", 0xFA: "ú",
  0xFB: "ű", 0xFC: "ü", 0xFD: "ý", 0xFE: "ţ", 0xFF: "˙",
};

function decodeCp1250(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) out += String.fromCharCode(b);
    else out += CP1250[b] ?? "?";
  }
  return out;
}

function looksLikeUtf8(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return true;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) { i++; continue; }
    let trail = 0;
    if ((b & 0xE0) === 0xC0) trail = 1;
    else if ((b & 0xF0) === 0xE0) trail = 2;
    else if ((b & 0xF8) === 0xF0) trail = 3;
    else return false;
    for (let j = 1; j <= trail; j++) {
      if (i + j >= bytes.length) return false;
      if ((bytes[i + j] & 0xC0) !== 0x80) return false;
    }
    i += trail + 1;
  }
  return true;
}

function decodeSmart(bytes: Uint8Array, hint: string | null): string {
  if (hint === "windows-1250" || hint === "cp1250") return decodeCp1250(bytes);
  if (hint === "utf-8" || hint === "utf8") {
    const start = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ? 3 : 0;
    return new TextDecoder("utf-8").decode(bytes.subarray(start));
  }
  if (looksLikeUtf8(bytes)) {
    const start = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ? 3 : 0;
    return new TextDecoder("utf-8").decode(bytes.subarray(start));
  }
  return decodeCp1250(bytes);
}

function detectDelimiter(firstLine: string): string {
  const semi = (firstLine.match(/;/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;
  const tab = (firstLine.match(/\t/g) || []).length;
  if (tab > semi && tab > comma) return "\t";
  if (semi >= comma) return ";";
  return ",";
}

// Minimální RFC4180 parser s podporou uvozovek.
function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delim) { cur.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") {
      cur.push(field); field = "";
      if (cur.length > 1 || cur[0] !== "") rows.push(cur);
      cur = [];
      continue;
    }
    field += c;
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (cur.length > 1 || cur[0] !== "") rows.push(cur);
  }
  return rows;
}

function toRowObjects(rows: string[][]): Array<Record<string, string>> {
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => { obj[h] = (r[i] ?? "").trim(); });
    return obj;
  });
}

function coerceForTable(table: string, row: Record<string, string>): Record<string, unknown> {
  const numericFields: Record<string, string[]> = {
    clients: ["budget_min", "budget_max"],
    properties: ["price", "area_m2", "rooms"],
    leads: ["client_id", "property_id", "estimated_commission"],
    transactions: ["property_id", "client_id", "sale_price", "commission"],
  };
  const nums = new Set(numericFields[table] ?? []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === "" || v === undefined) continue;
    if (nums.has(k)) {
      const cleaned = v.replace(/\s/g, "").replace(/,/g, ".");
      const n = Number(cleaned);
      if (Number.isFinite(n)) out[k] = n;
    } else {
      out[k] = v;
    }
  }
  return out;
}

const TABLES = ["clients", "properties", "leads", "transactions"] as const;
type TableName = typeof TABLES[number];

const TOOL_BY_TABLE: Record<TableName, string> = {
  clients: "add_client",
  properties: "add_property",
  leads: "add_lead",
  transactions: "add_transaction",
};

// Přejmenuje klíče v řádku podle mapping (zdrojový header → cílová DB kolona).
// Sloupce, které nejsou v mapping, jsou zahozeny. Prázdný/nedefinovaný mapping = identita.
function applyMapping(
  row: Record<string, string>,
  mapping: Record<string, string> | null,
): Record<string, string> {
  if (!mapping || Object.keys(mapping).length === 0) return row;
  const out: Record<string, string> = {};
  for (const [src, dst] of Object.entries(mapping)) {
    if (!dst) continue;
    if (row[src] !== undefined) out[dst] = row[src];
  }
  return out;
}

export async function POST(req: Request) {
  await ensureLocalReady();
  const form = await req.formData();
  const tableRaw = String(form.get("table") ?? "");
  if (!TABLES.includes(tableRaw as TableName)) {
    return NextResponse.json({ ok: false, error: `table musí být ${TABLES.join("/")}.` }, { status: 400 });
  }
  const table = tableRaw as TableName;
  const mode = String(form.get("mode") ?? "preview");
  const encodingHint = (form.get("encoding") as string | null) || null;
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ ok: false, error: "Chybí soubor." }, { status: 400 });
  }
  const mappingRaw = form.get("mapping");
  let mapping: Record<string, string> | null = null;
  if (typeof mappingRaw === "string" && mappingRaw.trim()) {
    try {
      const parsed = JSON.parse(mappingRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        mapping = parsed as Record<string, string>;
      }
    } catch {}
  }
  const buf = new Uint8Array(await (file as File).arrayBuffer());
  const text = decodeSmart(buf, encodingHint);
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delim = detectDelimiter(firstLine);
  const rows = parseCsv(text, delim);
  const objects = toRowObjects(rows);

  if (mode === "preview") {
    return NextResponse.json({
      ok: true,
      mode: "preview",
      table,
      delimiter: delim === "\t" ? "\\t" : delim,
      total: objects.length,
      columns: rows[0] ?? [],
      sample: objects.slice(0, 3),
    });
  }

  // mode === "commit" — skutečný import
  let inserted = 0;
  let skipped = 0;
  const errors: Array<{ row: number; error: string }> = [];
  for (let i = 0; i < objects.length; i++) {
    const mapped = applyMapping(objects[i], mapping);
    const input = coerceForTable(table, mapped);
    const res = await runTool(TOOL_BY_TABLE[table], input);
    if (res.ok) inserted++;
    else {
      const err = res.error ?? "neznámá chyba";
      // Duplicitu (UNIQUE constraint) rozpoznáme podle typické zprávy SQLite.
      if (/UNIQUE|duplic/i.test(err)) skipped++;
      errors.push({ row: i + 2, error: err });
    }
  }
  return NextResponse.json({
    ok: true,
    mode: "commit",
    table,
    total: objects.length,
    inserted,
    skipped,
    errors: errors.slice(0, 20),
    error_count: errors.length,
  });
}
