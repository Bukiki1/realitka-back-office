import { NextResponse } from "next/server";
import { dbGet, ensureLocalReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POZOR: tento endpoint pouze ověří, že je schéma připravené a vrátí aktuální
// počty záznamů. NIKDY automaticky neseeduje — prázdná DB je validní stav.
// Seed se spouští výhradně explicitně přes POST /api/seed (tlačítko v /import).

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

export async function GET() {
  await ensureLocalReady();
  const counts = await allCounts();
  return NextResponse.json({ ok: true, seeded: false, counts });
}
