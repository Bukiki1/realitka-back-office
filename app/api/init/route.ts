import { NextResponse } from "next/server";
import { getDb, ensureLocalReady } from "@/lib/db";
import { seed } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // ensureLocalReady se postará o init schématu + stažení Turso snapshotu
  // do /tmp souboru (pokud je Turso nakonfigurované). Na lokálu jen initSchema().
  await ensureLocalReady();
  const db = getDb();
  const url = new URL(req.url);
  const force = url.searchParams.get("reseed") === "1";

  const counts = {
    clients: (db.prepare(`SELECT COUNT(*) AS c FROM clients`).get() as any).c,
    properties: (db.prepare(`SELECT COUNT(*) AS c FROM properties`).get() as any).c,
    leads: (db.prepare(`SELECT COUNT(*) AS c FROM leads`).get() as any).c,
    transactions: (db.prepare(`SELECT COUNT(*) AS c FROM transactions`).get() as any).c,
  };

  // Automaticky re-seed, pokud chybí data z rozšířeného schématu
  // (např. po migraci sloupců v leads/clients) — poznáme podle last_contact_at.
  let needsReseed = counts.clients === 0 || counts.properties === 0 || force;
  if (!needsReseed && counts.leads > 0) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE last_contact_at IS NOT NULL`).get() as { c: number };
    if (row.c === 0) needsReseed = true;
  }

  if (needsReseed) {
    await seed();
    const newCounts = {
      clients: (db.prepare(`SELECT COUNT(*) AS c FROM clients`).get() as any).c,
      properties: (db.prepare(`SELECT COUNT(*) AS c FROM properties`).get() as any).c,
      leads: (db.prepare(`SELECT COUNT(*) AS c FROM leads`).get() as any).c,
      transactions: (db.prepare(`SELECT COUNT(*) AS c FROM transactions`).get() as any).c,
    };
    return NextResponse.json({ seeded: true, counts: newCounts });
  }

  return NextResponse.json({ seeded: false, counts });
}
