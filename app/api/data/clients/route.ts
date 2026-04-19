import { NextResponse } from "next/server";
import { getDb, ensureLocalReady } from "@/lib/db";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureLocalReady();
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM clients ORDER BY id`).all();
  return NextResponse.json({ count: rows.length, clients: rows });
}

export async function POST(req: Request) {
  await ensureLocalReady();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Očekáván JSON body." }, { status: 400 });
  }
  const res = await runTool("add_client", body);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  const data = (res.data ?? {}) as { id?: number; row?: unknown };
  return NextResponse.json({ ok: true, id: data.id, client: data.row }, { status: 201 });
}
