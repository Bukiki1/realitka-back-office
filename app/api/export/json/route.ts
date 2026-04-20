import { NextResponse } from "next/server";
import { dbAll, ensureLocalReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureLocalReady();
  const [clients, properties, leads, transactions] = await Promise.all([
    dbAll(`SELECT * FROM clients ORDER BY id`),
    dbAll(`SELECT * FROM properties ORDER BY id`),
    dbAll(`SELECT * FROM leads ORDER BY id`),
    dbAll(`SELECT * FROM transactions ORDER BY id`),
  ]);
  const dump = {
    exported_at: new Date().toISOString(),
    clients,
    properties,
    leads,
    transactions,
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
