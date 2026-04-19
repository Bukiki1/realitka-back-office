import { NextResponse } from "next/server";
import { getDb, dbRun, ensureLocalReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE = ["property_id", "client_id", "sale_price", "commission", "transaction_date"];

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
  await dbRun(`UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`, args);
  const row = getDb().prepare(`SELECT * FROM transactions WHERE id = ?`).get(id);
  return NextResponse.json({ ok: true, transaction: row });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await ensureLocalReady();
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "Neplatné id." }, { status: 400 });
  await dbRun(`DELETE FROM transactions WHERE id = ?`, [id]);
  return NextResponse.json({ ok: true, id });
}
