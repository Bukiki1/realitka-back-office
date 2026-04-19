import { NextResponse } from "next/server";
import { getDb, getTursoClient, hasTursoConfig, initSchema } from "@/lib/db";
import { seed } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Turso embedded replica: při prvním volání (nebo po cold-startu na Vercelu,
  // kde je /tmp prázdný) nejdřív stáhneme poslední stav z cloudu. getTursoClient()
  // vytvoří lokální soubor file:/tmp/realitka.db synchronizovaný s remote URL a
  // provede initial sync. Pokud Turso není nastaveno, funkce vrátí null a my
  // pokračujeme s čistě lokální better-sqlite3 databází.
  if (hasTursoConfig()) {
    try {
      await getTursoClient();
    } catch (err) {
      console.warn("[init] Turso sync failed:", err instanceof Error ? err.message : err);
    }
  }
  initSchema();
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
    seed();
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
