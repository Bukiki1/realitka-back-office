import { NextResponse } from "next/server";
import { dbGet, ensureLocalReady } from "@/lib/db";
import { seed } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function allCounts() {
  const c = async (t: string): Promise<number> =>
    (await dbGet<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`))?.c ?? 0;
  return {
    clients: await c("clients"),
    properties: await c("properties"),
    leads: await c("leads"),
    transactions: await c("transactions"),
  };
}

export async function GET(req: Request) {
  await ensureLocalReady();
  const url = new URL(req.url);
  const force = url.searchParams.get("reseed") === "1";

  const counts = await allCounts();

  // Automaticky re-seed, pokud chybí data z rozšířeného schématu.
  let needsReseed = counts.clients === 0 || counts.properties === 0 || force;
  if (!needsReseed && counts.leads > 0) {
    const row = await dbGet<{ c: number }>(`SELECT COUNT(*) AS c FROM leads WHERE last_contact_at IS NOT NULL`);
    if ((row?.c ?? 0) === 0) needsReseed = true;
  }

  if (needsReseed) {
    await seed();
    return NextResponse.json({ seeded: true, counts: await allCounts() });
  }

  return NextResponse.json({ seeded: false, counts });
}
