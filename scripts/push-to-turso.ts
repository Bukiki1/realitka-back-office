/**
 * Push seed data → Turso cloud.
 *
 * S novým lib/db.ts stačí zavolat seed() s nastavenými TURSO env vars —
 * všechny zápisy jdou přímo do cloudu přes libsql client.
 *
 * Použití:
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/push-to-turso.ts
 */

import { seed } from "../lib/seed";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error("Chybí TURSO_DATABASE_URL nebo TURSO_AUTH_TOKEN v env.");
    process.exit(1);
  }
  console.log("→ Seedování → Turso:", url);
  await seed();
  console.log("→ Hotovo.");
}

main().catch((err) => {
  console.error("CHYBA:", err);
  process.exit(1);
});
