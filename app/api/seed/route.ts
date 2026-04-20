import { NextResponse } from "next/server";
import { dbGet, ensureLocalReady } from "@/lib/db";
import { seed } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Explicitní (ruční) naplnění demo daty. Spouští se pouze z tlačítka na /import,
// nikdy automaticky při načtení stránky nebo prvním API callu.

async function allCounts() {
  const c = async (t: string): Promise<number> =>
    (await dbGet<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`))?.c ?? 0;
  return {
    clients: await c("clients"),
    properties: await c("properties"),
    leads: await c("leads"),
    transactions: await c("transactions"),
    calendar_events: await c("calendar_events"),
  };
}

export async function POST(req: Request) {
  await ensureLocalReady();
  let body: { confirm?: string } = {};
  try { body = await req.json(); } catch {}
  if (body.confirm !== "SEED") {
    return NextResponse.json(
      { ok: false, error: 'Pro potvrzení zaslat { "confirm": "SEED" }.' },
      { status: 400 },
    );
  }
  await seed();
  return NextResponse.json({ ok: true, seeded: true, counts: await allCounts() });
}
