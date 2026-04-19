import { NextResponse } from "next/server";
import { getDb, initSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  initSchema();
  let body: { confirm?: string } = {};
  try {
    body = await req.json();
  } catch {}
  if (body.confirm !== "SMAZAT") {
    return NextResponse.json(
      { ok: false, error: 'Pro potvrzení zaslat { "confirm": "SMAZAT" }.' },
      { status: 400 },
    );
  }
  const db = getDb();
  const before = {
    clients: (db.prepare(`SELECT COUNT(*) AS c FROM clients`).get() as { c: number }).c,
    properties: (db.prepare(`SELECT COUNT(*) AS c FROM properties`).get() as { c: number }).c,
    leads: (db.prepare(`SELECT COUNT(*) AS c FROM leads`).get() as { c: number }).c,
    transactions: (db.prepare(`SELECT COUNT(*) AS c FROM transactions`).get() as { c: number }).c,
    calendar_events: (db.prepare(`SELECT COUNT(*) AS c FROM calendar_events`).get() as { c: number }).c,
  };
  const tx = db.transaction(() => {
    db.exec(`DELETE FROM calendar_events; DELETE FROM transactions; DELETE FROM leads; DELETE FROM properties; DELETE FROM clients;`);
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('clients','properties','leads','transactions','calendar_events');`);
  });
  try {
    tx();
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, cleared: before });
}
