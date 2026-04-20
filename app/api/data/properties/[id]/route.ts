import { NextResponse } from "next/server";
import { dbGet, dbRun, ensureLocalReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE = [
  "address", "city", "district", "type", "price", "area_m2",
  "rooms", "status", "reconstruction_data", "building_modifications", "description",
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
  await dbRun(`UPDATE properties SET ${sets.join(", ")} WHERE id = ?`, args);
  const row = await dbGet(`SELECT * FROM properties WHERE id = ?`, [id]);
  return NextResponse.json({ ok: true, property: row });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await ensureLocalReady();
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "Neplatné id." }, { status: 400 });
  // Závislé záznamy nejdřív: transakce → leady. Kalendářní události zachováme,
  // jen u nich vynulujeme property_id.
  await dbRun(`DELETE FROM transactions WHERE property_id = ?`, [id]);
  await dbRun(`DELETE FROM leads WHERE property_id = ?`, [id]);
  await dbRun(`UPDATE calendar_events SET property_id = NULL WHERE property_id = ?`, [id]);
  await dbRun(`DELETE FROM properties WHERE id = ?`, [id]);
  return NextResponse.json({ ok: true, id });
}
