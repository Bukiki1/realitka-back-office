import { NextResponse } from "next/server";
import { dbAll, dbGet, dbRun, ensureLocalReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureLocalReady();
  const rows = await dbAll(`SELECT * FROM calendar_events ORDER BY start_time DESC`);
  return NextResponse.json({ count: rows.length, events: rows });
}

export async function POST(req: Request) {
  await ensureLocalReady();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Očekáván JSON." }, { status: 400 }); }
  const title = String(body.title ?? "").trim();
  const start_time = String(body.start_time ?? "").trim();
  const end_time = String(body.end_time ?? "").trim();
  const type = String(body.type ?? "meeting");
  if (!title || !start_time || !end_time) {
    return NextResponse.json({ ok: false, error: "Chybí title / start_time / end_time." }, { status: 400 });
  }
  const info = await dbRun(
    `INSERT INTO calendar_events (title, client_id, property_id, start_time, end_time, type, location, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      typeof body.client_id === "number" ? body.client_id : null,
      typeof body.property_id === "number" ? body.property_id : null,
      start_time,
      end_time,
      type,
      typeof body.location === "string" ? body.location : null,
      typeof body.notes === "string" ? body.notes : null,
      new Date().toISOString().slice(0, 19).replace("T", " "),
    ],
  );
  const id = Number(info.lastInsertRowid);
  const row = await dbGet(`SELECT * FROM calendar_events WHERE id = ?`, [id]);
  return NextResponse.json({ ok: true, id, event: row }, { status: 201 });
}
