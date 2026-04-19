import { NextResponse } from "next/server";
import { getDb, initSchema } from "@/lib/db";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  initSchema();
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM properties ORDER BY id`).all();
  return NextResponse.json({ count: rows.length, properties: rows });
}

export async function POST(req: Request) {
  initSchema();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Očekáván JSON body." }, { status: 400 });
  }
  const res = await runTool("add_property", body);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  const data = (res.data ?? {}) as { id?: number; row?: unknown };
  return NextResponse.json({ ok: true, id: data.id, property: data.row }, { status: 201 });
}
