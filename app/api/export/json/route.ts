import { NextResponse } from "next/server";
import { getDb, ensureLocalReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureLocalReady();
  const db = getDb();
  const dump = {
    exported_at: new Date().toISOString(),
    clients: db.prepare(`SELECT * FROM clients ORDER BY id`).all(),
    properties: db.prepare(`SELECT * FROM properties ORDER BY id`).all(),
    leads: db.prepare(`SELECT * FROM leads ORDER BY id`).all(),
    transactions: db.prepare(`SELECT * FROM transactions ORDER BY id`).all(),
  };
  const body = JSON.stringify(dump, null, 2);
  const filename = `realitka-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
