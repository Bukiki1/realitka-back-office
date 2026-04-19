import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// ─────────────────────────── Storage path ───────────────────────────
// V produkci (Vercel) je projektový filesystem read-only; psát lze jen do /tmp.
// Detekujeme podle VERCEL env var a přesměrujeme DB soubor do ephemerálního /tmp.
// Pro trvalou persistenci je nutné mít nastavené TURSO_DATABASE_URL + TURSO_AUTH_TOKEN.
// V tom případě všechny zápisy jdou přes libsql client rovnou do remote Turso DB,
// takže jsou persistentní napříč serverless instancemi.

const IS_VERCEL = Boolean(process.env.VERCEL);
const DB_DIR = IS_VERCEL ? "/tmp" : path.join(process.cwd(), "data");
const PROD_DB_PATH = path.join(DB_DIR, "realitka.db");
const TEST_DB_PATH = path.join(DB_DIR, "test_database.db");
const MODE_MARKER = path.join(DB_DIR, ".mode.json");

export type DbMode = "prod" | "test";

function readMode(): DbMode {
  try {
    if (!fs.existsSync(MODE_MARKER)) return "prod";
    const raw = fs.readFileSync(MODE_MARKER, "utf-8");
    const parsed = JSON.parse(raw) as { mode?: string };
    return parsed.mode === "test" ? "test" : "prod";
  } catch {
    return "prod";
  }
}

function writeMode(mode: DbMode): void {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(MODE_MARKER, JSON.stringify({ mode }), "utf-8");
}

export function getDbMode(): DbMode {
  return readMode();
}

export function getDbPath(): string {
  return readMode() === "test" ? TEST_DB_PATH : PROD_DB_PATH;
}

// Zpětná kompatibilita — některé části kódu mohou importovat DB_PATH.
export const DB_PATH = PROD_DB_PATH;

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

// getDb() zůstává synchronní pro READ operace. Na Vercelu čte ze /tmp souboru,
// který je plněn Turso embedded replicou při prvním getTursoClient() volání
// (typicky v /api/init). Všechny WRITE operace MUSÍ jít přes asynchronní
// helpery (dbRun / dbExec / dbBatch) — jinak se zápisy na Vercelu nepropíšou
// do cloudu a zmizí s ephemerální instancí.
export function getDb(): Database.Database {
  const targetPath = getDbPath();
  if (_db && _dbPath === targetPath) return _db;
  if (_db && _dbPath !== targetPath) {
    try { _db.close(); } catch {}
    _db = null;
  }
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(targetPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  _db = db;
  _dbPath = targetPath;
  return db;
}

export function resetDbCache(): void {
  if (_db) {
    try { _db.close(); } catch {}
  }
  _db = null;
  _dbPath = null;
}

export function enterTestMode(): { copied: boolean } {
  if (IS_VERCEL) {
    throw new Error("Testovací režim není dostupný na Vercel (ephemerální filesystem).");
  }
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  resetDbCache();
  let copied = false;
  if (fs.existsSync(PROD_DB_PATH)) {
    fs.copyFileSync(PROD_DB_PATH, TEST_DB_PATH);
    copied = true;
    for (const suf of ["-wal", "-shm"]) {
      const p = TEST_DB_PATH + suf;
      if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
    }
  }
  writeMode("test");
  return { copied };
}

export function exitTestMode(action: "discard" | "commit"): void {
  if (IS_VERCEL) {
    throw new Error("Testovací režim není dostupný na Vercel.");
  }
  resetDbCache();
  if (action === "commit" && fs.existsSync(TEST_DB_PATH)) {
    fs.copyFileSync(TEST_DB_PATH, PROD_DB_PATH);
    for (const suf of ["-wal", "-shm"]) {
      const p = PROD_DB_PATH + suf;
      if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
    }
  }
  for (const p of [TEST_DB_PATH, TEST_DB_PATH + "-wal", TEST_DB_PATH + "-shm"]) {
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
  }
  writeMode("prod");
}

// ─────────────────────────── Turso (libSQL) ───────────────────────────
// Klient pro Turso cloud. Režimy:
//   • "remote"  — TURSO_DATABASE_URL + TURSO_AUTH_TOKEN nastavené → veškeré zápisy
//                 jdou přímo do cloudu přes HTTP. Lokální /tmp soubor slouží jen
//                 jako read-cache (plněný při getTursoClient() sync'em z cloudu).
//   • "local"   — Turso nenastaveno → write helpery používají better-sqlite3
//                 nad lokálním souborem (dev i self-hosted).

type LibsqlResultSet = { lastInsertRowid?: bigint | number; rowsAffected?: number };
type LibsqlClient = {
  execute: (query: string | { sql: string; args?: unknown[] }) => Promise<LibsqlResultSet>;
  executeMultiple?: (sql: string) => Promise<unknown>;
  batch: (stmts: Array<string | { sql: string; args?: unknown[] }>, mode?: "write" | "read" | "deferred") => Promise<unknown>;
  sync?: () => Promise<unknown>;
  close: () => void;
};

let _tursoClient: LibsqlClient | null = null;
let _tursoInitPromise: Promise<LibsqlClient | null> | null = null;

export function hasTursoConfig(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL);
}

export async function getTursoClient(): Promise<LibsqlClient | null> {
  if (!hasTursoConfig()) return null;
  if (_tursoClient) return _tursoClient;
  if (_tursoInitPromise) return _tursoInitPromise;
  _tursoInitPromise = (async () => {
    const { createClient } = await import("@libsql/client");
    const url = process.env.TURSO_DATABASE_URL!;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    // Používáme čistě remote klient (žádná embedded replica), takže všechny zápisy
    // i čtení přes tento klient jdou rovnou do cloudu. Lokální /tmp soubor je nezávislý
    // a slouží jen pro synchronní better-sqlite3 čtení (naplníme ho sync'em níže).
    _tursoClient = createClient({ url, authToken }) as unknown as LibsqlClient;
    return _tursoClient;
  })();
  try {
    return await _tursoInitPromise;
  } catch (err) {
    console.warn("[turso] client init failed:", err instanceof Error ? err.message : err);
    _tursoInitPromise = null;
    return null;
  }
}

// Stáhne celou remote DB do lokálního /tmp souboru, aby synchronní getDb() reads
// viděly čerstvá data. Voláme při cold startu z /api/init.
export async function pullTursoSnapshot(): Promise<void> {
  if (!hasTursoConfig()) return;
  const client = await getTursoClient();
  if (!client) return;
  try {
    // Vytáhnout všechny řádky z každé tabulky a přepsat lokální better-sqlite3 DB.
    const tables = ["clients", "properties", "leads", "transactions", "calendar_events"] as const;
    // Nejdřív se ujistit, že lokální schéma existuje.
    const db = getDb();
    db.exec(SCHEMA);
    for (const m of MIGRATIONS) ensureColumnSync(db, m.table, m.column, m.type);
    db.exec(INDEXES);

    // Vyprázdnit a nahradit data.
    db.exec(`DELETE FROM calendar_events; DELETE FROM transactions; DELETE FROM leads; DELETE FROM properties; DELETE FROM clients;`);
    for (const table of tables) {
      const result = await client.execute({ sql: `SELECT * FROM ${table}` });
      const rs = result as unknown as { columns?: string[]; rows?: unknown[][] };
      const cols = rs.columns ?? [];
      const rows = rs.rows ?? [];
      if (rows.length === 0 || cols.length === 0) continue;
      const placeholders = cols.map(() => "?").join(", ");
      const stmt = db.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`);
      const tx = db.transaction((rs2: unknown[][]) => {
        for (const r of rs2) stmt.run(...(r as unknown[]));
      });
      tx(rows);
    }
  } catch (err) {
    console.warn("[turso] snapshot pull failed:", err instanceof Error ? err.message : err);
  }
}

// ─────────────────────────── Async write API ───────────────────────────
// Všechny zápisy do DB MUSÍ používat tyto helpery místo db.prepare().run().
// Na Vercelu (TURSO) odeslou SQL rovnou do cloudu i aktualizují lokální
// /tmp soubor, aby následná synchronní čtení viděla svěží data.

export type RunResult = { lastInsertRowid: number; changes: number };

function runLocalSync(sql: string, args: unknown[]): RunResult {
  const db = getDb();
  const info = db.prepare(sql).run(...(args as any[]));
  return { lastInsertRowid: Number(info.lastInsertRowid), changes: info.changes };
}

function libsqlArgs(args: unknown[]): any[] {
  // libsql nepodporuje undefined — převádíme na null.
  return args.map((a) => (a === undefined ? null : a)) as any[];
}

export async function dbRun(sql: string, args: unknown[] = []): Promise<RunResult> {
  if (hasTursoConfig()) {
    const client = await getTursoClient();
    if (client) {
      const res = await client.execute({ sql, args: libsqlArgs(args) });
      // Zároveň zapsat lokálně, aby synchronní čtení to viděla.
      try { runLocalSync(sql, args); } catch {}
      const rid = res.lastInsertRowid;
      const lastInsertRowid = typeof rid === "bigint" ? Number(rid) : Number(rid ?? 0);
      return { lastInsertRowid, changes: Number(res.rowsAffected ?? 0) };
    }
  }
  return runLocalSync(sql, args);
}

export async function dbExec(sql: string): Promise<void> {
  if (hasTursoConfig()) {
    const client = await getTursoClient();
    if (client) {
      if (client.executeMultiple) {
        await client.executeMultiple(sql);
      } else {
        // Rozdělit na jednotlivé statementy (primitivní split; stačí pro naše SCHEMA).
        const parts = sql.split(";").map((s) => s.trim()).filter(Boolean);
        for (const p of parts) await client.execute({ sql: p });
      }
      try { getDb().exec(sql); } catch {}
      return;
    }
  }
  getDb().exec(sql);
}

export async function dbBatch(
  stmts: Array<{ sql: string; args?: unknown[] }>,
): Promise<void> {
  if (stmts.length === 0) return;
  if (hasTursoConfig()) {
    const client = await getTursoClient();
    if (client) {
      // Turso má limit ~100 statementů na batch; rozdělíme na chunky.
      const CHUNK = 100;
      for (let i = 0; i < stmts.length; i += CHUNK) {
        const chunk = stmts.slice(i, i + CHUNK);
        await client.batch(
          chunk.map((s) => ({ sql: s.sql, args: libsqlArgs(s.args ?? []) })),
          "write",
        );
      }
      // Mirror lokálně.
      try {
        const db = getDb();
        const tx = db.transaction((list: typeof stmts) => {
          for (const s of list) db.prepare(s.sql).run(...((s.args ?? []) as any[]));
        });
        tx(stmts);
      } catch {}
      return;
    }
  }
  const db = getDb();
  const tx = db.transaction((list: typeof stmts) => {
    for (const s of list) db.prepare(s.sql).run(...((s.args ?? []) as any[]));
  });
  tx(stmts);
}

// ─────────────────────────── Schema ───────────────────────────

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('web','doporučení','inzerát','sociální sítě')),
  created_at TEXT NOT NULL,
  quarter TEXT NOT NULL,
  budget_min INTEGER,
  budget_max INTEGER,
  preferred_locality TEXT,
  preferred_rooms TEXT,
  preferred_type TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('byt','dům','komerční')),
  price INTEGER NOT NULL,
  area_m2 INTEGER NOT NULL,
  rooms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('aktivní','prodáno','rezervováno')),
  reconstruction_data TEXT,
  building_modifications TEXT,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  property_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('nový','kontaktován','prohlídka','nabídka','uzavřen')),
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_contact_at TEXT,
  next_action TEXT,
  estimated_commission REAL,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (property_id) REFERENCES properties(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  sale_price INTEGER NOT NULL,
  commission INTEGER NOT NULL,
  transaction_date TEXT NOT NULL,
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  client_id INTEGER,
  property_id INTEGER,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('prohlídka','meeting','hovor','jiné')),
  location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (property_id) REFERENCES properties(id)
);

`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_leads_client ON leads(client_id);
CREATE INDEX IF NOT EXISTS idx_leads_property ON leads(property_id);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_last_contact ON leads(last_contact_at);
CREATE INDEX IF NOT EXISTS idx_properties_city ON properties(city);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_cal_client ON calendar_events(client_id);
CREATE INDEX IF NOT EXISTS idx_cal_property ON calendar_events(property_id);
`;

const MIGRATIONS: Array<{ table: string; column: string; type: string }> = [
  { table: "clients", column: "budget_min", type: "INTEGER" },
  { table: "clients", column: "budget_max", type: "INTEGER" },
  { table: "clients", column: "preferred_locality", type: "TEXT" },
  { table: "clients", column: "preferred_rooms", type: "TEXT" },
  { table: "clients", column: "preferred_type", type: "TEXT" },
  { table: "clients", column: "notes", type: "TEXT" },
  { table: "leads", column: "last_contact_at", type: "TEXT" },
  { table: "leads", column: "next_action", type: "TEXT" },
  { table: "leads", column: "estimated_commission", type: "REAL" },
];

function ensureColumnSync(db: Database.Database, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

async function ensureColumnRemote(client: LibsqlClient, table: string, column: string, type: string) {
  try {
    const res = await client.execute({ sql: `PRAGMA table_info(${table})` });
    const rs = res as unknown as { rows?: Array<Record<string, unknown>> };
    const rows = rs.rows ?? [];
    const exists = rows.some((r) => String((r as any).name ?? (r as any)[1]) === column);
    if (!exists) {
      await client.execute({ sql: `ALTER TABLE ${table} ADD COLUMN ${column} ${type}` });
    }
  } catch (err) {
    console.warn(`[turso] ensureColumn ${table}.${column} failed:`, err instanceof Error ? err.message : err);
  }
}

// initSchema běží POUZE lokálně (synchronně). Je to safety net pro dev.
// Na Turso schéma zakládá initSchemaAsync (viz níže) — voláno z /api/init.
export function initSchema() {
  const db = getDb();
  db.exec(SCHEMA);
  for (const m of MIGRATIONS) ensureColumnSync(db, m.table, m.column, m.type);
  db.exec(INDEXES);
}

export async function initSchemaAsync(): Promise<void> {
  if (hasTursoConfig()) {
    const client = await getTursoClient();
    if (client) {
      const parts = SCHEMA.split(";").map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        try { await client.execute({ sql: p }); } catch (err) {
          console.warn("[turso] schema stmt failed:", err instanceof Error ? err.message : err);
        }
      }
      for (const m of MIGRATIONS) await ensureColumnRemote(client, m.table, m.column, m.type);
      const idx = INDEXES.split(";").map((s) => s.trim()).filter(Boolean);
      for (const p of idx) {
        try { await client.execute({ sql: p }); } catch {}
      }
    }
  }
  // Vždy zajisti i lokální schéma (pro synchronní čtení).
  initSchema();
}

// Legacy helper — dřív volal client.sync(). Zachováno pro zpětnou kompatibilitu.
export async function syncTursoIfConfigured(): Promise<void> {
  // V režimu čistě remote klienta už není co syncovat — zápisy jdou přímo do cloudu.
  return;
}

// ─────────────────────────── Readiness ───────────────────────────
// Jeden volitelný entry-point, který se stará o:
//   1) Lokální schéma existuje (pro synchronní better-sqlite3 čtení)
//   2) Pokud je Turso nastaveno, stáhne čerstvý snapshot z cloudu do /tmp
// Voláno z API routes místo initSchema(). Memoizováno — po první úspěšné
// inicializaci na dané instanci už nic nedělá.

let _readyPromise: Promise<void> | null = null;

export async function ensureLocalReady(): Promise<void> {
  if (_readyPromise) return _readyPromise;
  _readyPromise = (async () => {
    if (hasTursoConfig()) {
      await initSchemaAsync();
      await pullTursoSnapshot();
    } else {
      initSchema();
    }
  })();
  try {
    await _readyPromise;
  } catch (err) {
    _readyPromise = null;
    throw err;
  }
}
