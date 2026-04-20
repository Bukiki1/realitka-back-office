import { NextResponse } from "next/server";
import { dbGet, ensureLocalReady, dbExec } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TABLES = ["clients", "properties", "leads", "transactions", "calendar_events"] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

export async function POST(req: Request) {
  await ensureLocalReady();
  let body: { confirm?: string; table?: string } = {};
  try { body = await req.json(); } catch {}
  if (body.confirm !== "SMAZAT") {
    return NextResponse.json(
      { ok: false, error: 'Pro potvrzení zaslat { "confirm": "SMAZAT" }.' },
      { status: 400 },
    );
  }
  const singleTable = body.table && ALLOWED_TABLES.includes(body.table as AllowedTable)
    ? (body.table as AllowedTable) : null;

  const count = async (t: string): Promise<number> => {
    const row = await dbGet<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`);
    return row?.c ?? 0;
  };

  try {
    if (singleTable) {
      const before = await count(singleTable);
      // Při mazání rodičovských tabulek nejdřív vyčistit závislé leads/transakce.
      if (singleTable === "clients") {
        await dbExec(`DELETE FROM transactions; DELETE FROM leads; DELETE FROM clients;`);
      } else if (singleTable === "properties") {
        await dbExec(`DELETE FROM transactions; DELETE FROM leads; DELETE FROM properties;`);
      } else {
        await dbExec(`DELETE FROM ${singleTable};`);
      }
      await dbExec(`DELETE FROM sqlite_sequence WHERE name = '${singleTable}';`);
      return NextResponse.json({ ok: true, table: singleTable, cleared: before });
    }

    const before = {
      clients: await count("clients"),
      properties: await count("properties"),
      leads: await count("leads"),
      transactions: await count("transactions"),
      calendar_events: await count("calendar_events"),
    };
    await dbExec(`DELETE FROM calendar_events; DELETE FROM transactions; DELETE FROM leads; DELETE FROM properties; DELETE FROM clients;`);
    await dbExec(`DELETE FROM sqlite_sequence WHERE name IN ('clients','properties','leads','transactions','calendar_events');`);
    return NextResponse.json({ ok: true, cleared: before });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
