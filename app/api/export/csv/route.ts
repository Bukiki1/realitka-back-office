import { NextResponse } from "next/server";
import { getDb, initSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["clients", "properties", "leads", "transactions"] as const;
type Table = typeof ALLOWED[number];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const header = cols.join(",");
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

export async function GET(req: Request) {
  initSchema();
  const url = new URL(req.url);
  const tableParam = url.searchParams.get("table") ?? "";
  if (!ALLOWED.includes(tableParam as Table)) {
    return NextResponse.json({ ok: false, error: `table musí být ${ALLOWED.join("/")}.` }, { status: 400 });
  }
  const table = tableParam as Table;
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Array<Record<string, unknown>>;
  const csv = "\uFEFF" + rowsToCsv(rows); // BOM kvůli Excelu
  const filename = `realitka-${table}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
