import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// ─────────────────────────── Storage path ───────────────────────────
// V produkci (Vercel) je projektový filesystem read-only; psát lze jen do /tmp.
// Detekujeme podle VERCEL env var a přesměrujeme DB soubor do ephemerálního /tmp.
// Pro trvalou persistenci je nutné mít nastavené TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
// a použít embedded replica (viz getTursoClient níže).

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

// Přepne instanci do testovacího režimu — vytvoří/refreshne kopii produkční DB
// pod test_database.db a přeloží marker. Volání uzavře cached _db, aby další
// getDb() otevřel testovací soubor.
export function enterTestMode(): { copied: boolean } {
  if (IS_VERCEL) {
    throw new Error("Testovací režim není dostupný na Vercel (ephemerální filesystem).");
  }
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  // Uzavřít aktuální spojení, aby SQLite uvolnil handly před kopírováním.
  resetDbCache();
  let copied = false;
  if (fs.existsSync(PROD_DB_PATH)) {
    fs.copyFileSync(PROD_DB_PATH, TEST_DB_PATH);
    copied = true;
    // WAL + SHM kopírovat nemusíme — SQLite si je vytvoří znovu.
    // Ale smažeme staré test WAL/SHM, aby se nekombinovaly.
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
// Asynchronní klient pro Turso cloud DB. Používá se pro:
//   1) Embedded replica — lokální SQLite soubor synchronizovaný s cloudem
//      (pro produkci na Vercelu, kde je filesystem ephemerální).
//   2) Čistě remote dotazy, pokud je potřeba.
//
// Pozn.: celá aplikace používá synchronní API better-sqlite3 (getDb()).
// Plný přechod na async libSQL client by vyžadoval refaktor tools.ts a API
// routes. Funkce getTursoClient() je připravený endpoint pro migrační kroky;
// pokud je TURSO_DATABASE_URL nastaveno, lze nad ním postavit embedded replica
// tak, že ji synchronizujeme do DB_PATH a better-sqlite3 nad tím dál funguje.

type TursoClient = {
  execute: (query: string | { sql: string; args?: unknown[] }) => Promise<unknown>;
  batch: (stmts: Array<string | { sql: string; args?: unknown[] }>) => Promise<unknown>;
  sync?: () => Promise<unknown>;
  close: () => void;
};

let _tursoClient: TursoClient | null = null;

export function hasTursoConfig(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL);
}

export async function getTursoClient(): Promise<TursoClient | null> {
  if (!hasTursoConfig()) return null;
  if (_tursoClient) return _tursoClient;
  const { createClient } = await import("@libsql/client");
  const url = process.env.TURSO_DATABASE_URL!;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const syncUrl = url.startsWith("libsql://") || url.startsWith("wss://") || url.startsWith("https://")
    ? url
    : undefined;
  // Pokud je URL remote (libsql://... z Tursa), postavíme embedded replicu
  // do DB_PATH — tím si zachováme synchronní better-sqlite3 čtení nad stejným souborem.
  if (syncUrl) {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    _tursoClient = createClient({
      url: `file:${DB_PATH}`,
      syncUrl,
      authToken,
    }) as unknown as TursoClient;
    try {
      await _tursoClient.sync?.();
    } catch (err) {
      console.warn("[turso] initial sync failed:", err instanceof Error ? err.message : err);
    }
  } else {
    _tursoClient = createClient({ url, authToken }) as unknown as TursoClient;
  }
  return _tursoClient;
}

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

// Indexy vytváříme AŽ PO migracích sloupců — některé indexy se odkazují
// na sloupce, které nemusí existovat v DB před migrací.
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

// Dodatečné sloupce, které nemusí být v existující DB — přidáme je idempotentně.
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

function ensureColumn(db: Database.Database, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function initSchema() {
  const db = getDb();
  db.exec(SCHEMA);
  for (const m of MIGRATIONS) {
    ensureColumn(db, m.table, m.column, m.type);
  }
  db.exec(INDEXES);
}

// Volitelný helper: pokud je Turso nastaveno a jedeme v embedded replica módu,
// po zápisu do lokálního souboru zavoláme sync() aby se změny propsaly do cloudu.
// Volat ručně z CRUD cest (add_client, add_property, …) tam, kde to dává smysl.
export async function syncTursoIfConfigured(): Promise<void> {
  if (!hasTursoConfig()) return;
  try {
    const client = await getTursoClient();
    await client?.sync?.();
  } catch (err) {
    console.warn("[turso] sync failed:", err instanceof Error ? err.message : err);
  }
}
