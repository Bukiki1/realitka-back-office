/**
 * Push local seed data → Turso cloud.
 *
 * Postup:
 *   1. Spustí standardní seed() do lokálního data/realitka.db (better-sqlite3).
 *   2. Otevře remote Turso přes @libsql/client (čistě vzdáleně, bez embedded replica).
 *   3. Vytvoří schéma + vyprázdní tabulky + poleje je řádky z lokálního souboru.
 *
 * Použití:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/push-to-turso.mts
 */

import { createClient } from "@libsql/client";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { SCHEMA, initSchema } from "../lib/db";
import { seed } from "../lib/seed";

const TABLES = ["clients", "properties", "leads", "transactions", "calendar_events"] as const;

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error("Chybí TURSO_DATABASE_URL nebo TURSO_AUTH_TOKEN v env.");
    process.exit(1);
  }

  console.log("→ Seed → data/realitka.db");
  initSchema();
  seed();

  const localPath = path.join(process.cwd(), "data", "realitka.db");
  if (!fs.existsSync(localPath)) {
    console.error(`Lokální DB neexistuje: ${localPath}`);
    process.exit(1);
  }
  const local = new Database(localPath, { readonly: true });

  console.log("→ Připojuji se k Turso:", url);
  const remote = createClient({ url, authToken });

  console.log("→ Vytvářím schéma na Turso…");
  for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
    await remote.execute(stmt + ";");
  }

  // Idempotentní migrace sloupců pro případ, že je cloud verze starší.
  const MIGRATIONS = [
    ["clients", "budget_min", "INTEGER"],
    ["clients", "budget_max", "INTEGER"],
    ["clients", "preferred_locality", "TEXT"],
    ["clients", "preferred_rooms", "TEXT"],
    ["clients", "preferred_type", "TEXT"],
    ["clients", "notes", "TEXT"],
    ["leads", "last_contact_at", "TEXT"],
    ["leads", "next_action", "TEXT"],
    ["leads", "estimated_commission", "REAL"],
  ] as const;
  for (const [table, col, type] of MIGRATIONS) {
    const info = await remote.execute(`PRAGMA table_info(${table})`);
    const cols = (info.rows as unknown as Array<{ name: string }>).map((r) => r.name);
    if (!cols.includes(col)) {
      console.log(`   ALTER ${table} ADD ${col} ${type}`);
      await remote.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
  }

  console.log("→ Mažu staré řádky na Turso…");
  for (const t of [...TABLES].reverse()) {
    await remote.execute(`DELETE FROM ${t}`);
  }
  await remote.execute(
    `DELETE FROM sqlite_sequence WHERE name IN (${TABLES.map(() => "?").join(",")})`,
    TABLES as unknown as string[],
  );

  console.log("→ Přenáším řádky…");
  for (const table of TABLES) {
    const rows = local.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      console.log(`   ${table}: 0 řádků`);
      continue;
    }
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => "?").join(",");
    const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`;

    // Batch po 100 řádcích — Turso má limity na velikost requestu.
    const BATCH = 100;
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const stmts = chunk.map((row) => ({
        sql,
        args: cols.map((c) => (row[c] ?? null) as string | number | null),
      }));
      await remote.batch(stmts, "write");
      done += chunk.length;
    }
    console.log(`   ${table}: ${done} řádků`);
  }

  console.log("→ Hotovo. Turso je naplněno demo daty.");
  remote.close();
  local.close();
}

main().catch((err) => {
  console.error("CHYBA:", err);
  process.exit(1);
});
