import { NextResponse } from "next/server";
import { dbGet, dbRun, ensureLocalReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE = [
  "title", "client_id", "property_id", "start_time", "end_time",
  "type", "location", "notes",
];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await ensureLocalReady();
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "Neplatné id." }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Očekáván JSON." }, { status: 400 }); }
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const k of EDITABLE) {
    if (body[k] !== undefined) {
      sets.push(`${k} = ?`);
      args.push(body[k] === "" ? null : body[k]);
    }
  }
  if (sets.length === 0) return NextResponse.json({ ok: false, error: "Žádná pole k úpravě." }, { status: 400 });
  args.push(id);
  await dbRun(`UPDATE calendar_events SET ${sets.join(", ")} WHERE id = ?`, args);
  const row = await dbGet(`SELECT * FROM calendar_events WHERE id = ?`, [id]);
  return NextResponse.json({ ok: true, event: row });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await ensureLocalReady();
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "Neplatné id." }, { status: 400 });
  await dbRun(`DELETE FROM calendar_events WHERE id = ?`, [id]);
  return NextResponse.json({ ok: true, id });
}
