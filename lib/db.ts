import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// ─────────────────────────── Storage path ───────────────────────────
// Lokální better-sqlite3 soubor slouží jako rychlá read-cache pro synchronní čtení.
// Reálný zdroj pravdy je Turso cloud (pokud nastaveno). Zápisy (dbRun/dbExec/dbBatch)
// jdou přímo do Turso a zároveň se mirrorují lokálně, aby byla čtení čerstvá.
//
// Testovací režim: na Turso vytvoříme sadu tabulek s prefixem `test_` a zápisy
// i čtení se přepnou na tyto tabulky. Lokální /tmp soubor si pamatuje jen ten
// snapshot, který odpovídá právě aktivnímu režimu (prod nebo test).

const IS_VERCEL = Boolean(process.env.VERCEL);
const DB_DIR = IS_VERCEL ? "/tmp" : path.join(process.cwd(), "data");
const PROD_DB_PATH = path.join(DB_DIR, "realitka.db");
const MODE_MARKER = path.join(DB_DIR, ".mode.json");

export type DbMode = "prod" | "test";

export const BASE_TABLES = [
  "clients",
  "properties",
  "leads",
  "transactions",
  "calendar_events",
] as const;
export type BaseTable = (typeof BASE_TABLES)[number];

// ─────────────────────────── Mode state ───────────────────────────
// Mode je globální (jedna aplikace, jeden režim). Autoritativní uložení:
//   • Turso: řádek v `_app_state` table (key='mode')
//   • Local dev bez Turso: /tmp/.mode.json
//
// Server-side cache: _activeMode + _modeCachedAt s krátkým TTL, aby se mode
// nečetl z Turso při každém requestu.

let _activeMode: DbMode = "prod";
let _modeCachedAt = 0;
const MODE_TTL_MS = 2_000;

function readLocalModeFile(): DbMode {
  try {
    if (!fs.existsSync(MODE_MARKER)) return "prod";
    const raw = fs.readFileSync(MODE_MARKER, "utf-8");
    const parsed = JSON.parse(raw) as { mode?: string };
    return parsed.mode === "test" ? "test" : "prod";
  } catch {
    return "prod";
  }
}

function writeLocalModeFile(mode: DbMode): void {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(MODE_MARKER, JSON.stringify({ mode }), "utf-8");
}

async function readTursoMode(client: LibsqlClient): Promise<DbMode> {
  try {
    await client.execute({
      sql: `CREATE TABLE IF NOT EXISTS _app_state (key TEXT PRIMARY KEY, value TEXT)`,
    });
    const res = await client.execute({
      sql: `SELECT value FROM _app_state WHERE key = 'mode'`,
    });
    const rows = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    if (rows.length === 0) return "prod";
    const v = String(rows[0].value ?? "");
    return v === "test" ? "test" : "prod";
  } catch {
    return "prod";
  }
}

async function writeTursoMode(client: LibsqlClient, mode: DbMode): Promise<void> {
  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS _app_state (key TEXT PRIMARY KEY, value TEXT)`,
  });
  await client.execute({
    sql: `INSERT INTO _app_state (key, value) VALUES ('mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [mode],
  });
}

export async function getDbMode(): Promise<DbMode> {
  if (!hasTursoConfig()) return readLocalModeFile();
  const now = Date.now();
  if (now - _modeCachedAt < MODE_TTL_MS) return _activeMode;
  const client = await getTursoClient();
  if (!client) return _activeMode;
  const mode = await readTursoMode(client);
  _activeMode = mode;
  _modeCachedAt = now;
  return mode;
}

export function getDbModeSync(): DbMode {
  return _activeMode;
}

export function getDbPath(): string {
  return PROD_DB_PATH;
}

// Zpětná kompatibilita — některé části kódu mohou importovat DB_PATH.
export const DB_PATH = PROD_DB_PATH;

// ─────────────────────────── SQL rewriter ───────────────────────────
// V testovacím režimu přepisujeme názvy bazových tabulek na test_*
// při volání na Turso client. Lokální better-sqlite3 soubor si drží
// jen snapshot aktivního režimu, takže lokální SQL se nepřepisuje.

const TABLE_RE = new RegExp(
  `\\b(FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES)(\\s+)(${BASE_TABLES.join("|")})\\b`,
  "gi",
);

export function rewriteSqlForMode(sql: string, mode: DbMode): string {
  if (mode !== "test") return sql;
  return sql.replace(TABLE_RE, (_m, kw: string, ws: string, tbl: string) => `${kw}${ws}test_${tbl}`);
}

// ─────────────────────────── Connection ───────────────────────────

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

export function getDb(): Database.Database {
  const targetPath = PROD_DB_PATH;
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
  _readyPromise = null;
  _snapshotReady = false;
}

// ─────────────────────────── Turso (libSQL) ───────────────────────────

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

// Stáhne celou remote DB do lokálního souboru. V test módu stahuje z test_*
// tabulek, ale ukládá do lokálních base tabulek (lokální cache je mode-agnostic).
export async function pullTursoSnapshot(mode: DbMode = _activeMode): Promise<void> {
  if (!hasTursoConfig()) return;
  const client = await getTursoClient();
  if (!client) return;
  try {
    const db = getDb();
    db.exec(SCHEMA);
    for (const m of MIGRATIONS) ensureColumnSync(db, m.table, m.column, m.type);
    db.exec(INDEXES);
    db.exec(`DELETE FROM calendar_events; DELETE FROM transactions; DELETE FROM leads; DELETE FROM properties; DELETE FROM clients;`);
    for (const base of BASE_TABLES) {
      const remote = mode === "test" ? `test_${base}` : base;
      try {
        const result = await client.execute({ sql: `SELECT * FROM ${remote}` });
        const rs = result as unknown as { columns?: string[]; rows?: unknown[][] };
        const cols = rs.columns ?? [];
        const rows = rs.rows ?? [];
        if (rows.length === 0 || cols.length === 0) continue;
        const placeholders = cols.map(() => "?").join(", ");
        const stmt = db.prepare(
          `INSERT INTO ${base} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`,
        );
        const tx = db.transaction((rs2: unknown[][]) => {
          for (const r of rs2) stmt.run(...(r as unknown[]));
        });
        tx(rows);
      } catch (err) {
        // Chybějící test_ tabulka v test módu není fatální — mohla být zrušena.
        console.warn(`[turso] pull ${remote} failed:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.warn("[turso] snapshot pull failed:", err instanceof Error ? err.message : err);
  }
}

// ─────────────────────────── Async write API ───────────────────────────

export type RunResult = { lastInsertRowid: number; changes: number };

function runLocalSync(sql: string, args: unknown[]): RunResult {
  const db = getDb();
  const info = db.prepare(sql).run(...(args as any[]));
  return { lastInsertRowid: Number(info.lastInsertRowid), changes: info.changes };
}

function libsqlArgs(args: unknown[]): any[] {
  return args.map((a) => (a === undefined ? null : a)) as any[];
}

export async function dbRun(sql: string, args: unknown[] = []): Promise<RunResult> {
  if (hasTursoConfig()) {
    const client = await getTursoClient();
    if (client) {
      const rewritten = rewriteSqlForMode(sql, _activeMode);
      const res = await client.execute({ sql: rewritten, args: libsqlArgs(args) });
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
      const rewritten = rewriteSqlForMode(sql, _activeMode);
      if (client.executeMultiple) {
        await client.executeMultiple(rewritten);
      } else {
        const parts = rewritten.split(";").map((s) => s.trim()).filter(Boolean);
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
      const CHUNK = 100;
      for (let i = 0; i < stmts.length; i += CHUNK) {
        const chunk = stmts.slice(i, i + CHUNK);
        await client.batch(
          chunk.map((s) => ({ sql: rewriteSqlForMode(s.sql, _activeMode), args: libsqlArgs(s.args ?? []) })),
          "write",
        );
      }
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

// ─────────────────────────── Test mode ─────────────────────────────
// Na Turso: vytvoří sadu test_* tabulek jako kopii produkčních, nastaví mode=test
// v `_app_state`. Lokálně (dev bez Turso): fallback file-based copy.

async function rawRemoteExec(client: LibsqlClient, sql: string): Promise<void> {
  if (client.executeMultiple) {
    await client.executeMultiple(sql);
    return;
  }
  const parts = sql.split(";").map((s) => s.trim()).filter(Boolean);
  for (const p of parts) await client.execute({ sql: p });
}

function testSchemaSql(): string {
  // Schéma pro test_* tabulky — stejné jako produkce, jen přejmenované.
  return SCHEMA
    .replace(
      /CREATE TABLE IF NOT EXISTS (clients|properties|leads|transactions|calendar_events)\b/g,
      "CREATE TABLE test_$1",
    )
    .replace(
      /REFERENCES (clients|properties|leads|transactions|calendar_events)\(/g,
      "REFERENCES test_$1(",
    );
}

export async function enterTestMode(): Promise<{ copied: boolean }> {
  if (!hasTursoConfig()) {
    // Lokální fallback — souborová kopie jako dřív.
    return enterTestModeLocal();
  }
  const client = await getTursoClient();
  if (!client) throw new Error("Turso client unavailable");
  // Zajistit produkční schéma + migrace.
  await initSchemaAsync();
  // Smazat staré test_ tabulky (v opačném pořadí kvůli FK).
  for (const base of [...BASE_TABLES].reverse()) {
    await client.execute({ sql: `DROP TABLE IF EXISTS test_${base}` });
  }
  // Vytvořit čerstvé test_ tabulky s plným schématem.
  await rawRemoteExec(client, testSchemaSql());
  // Zkopírovat data z produkce.
  let copied = false;
  for (const base of BASE_TABLES) {
    const res = await client.execute({ sql: `INSERT INTO test_${base} SELECT * FROM ${base}` });
    const n = Number((res as unknown as { rowsAffected?: number }).rowsAffected ?? 0);
    if (n > 0) copied = true;
  }
  await writeTursoMode(client, "test");
  _activeMode = "test";
  _modeCachedAt = Date.now();
  // Refresh lokální cache — stáhni snapshot z test_ tabulek.
  await pullTursoSnapshot("test");
  return { copied };
}

export async function exitTestMode(action: "discard" | "commit"): Promise<void> {
  if (!hasTursoConfig()) {
    return exitTestModeLocal(action);
  }
  const client = await getTursoClient();
  if (!client) throw new Error("Turso client unavailable");
  if (action === "commit") {
    // Přepiš produkční data daty z test_. Mazat v opačném pořadí kvůli FK.
    for (const base of [...BASE_TABLES].reverse()) {
      await client.execute({ sql: `DELETE FROM ${base}` });
    }
    for (const base of BASE_TABLES) {
      await client.execute({ sql: `INSERT INTO ${base} SELECT * FROM test_${base}` });
    }
  }
  // Smaž test_ tabulky (v opačném pořadí).
  for (const base of [...BASE_TABLES].reverse()) {
    await client.execute({ sql: `DROP TABLE IF EXISTS test_${base}` });
  }
  await writeTursoMode(client, "prod");
  _activeMode = "prod";
  _modeCachedAt = Date.now();
  await pullTursoSnapshot("prod");
}

// Lokální fallback — dev-only, zachováno pro zpětnou kompatibilitu.
function enterTestModeLocal(): { copied: boolean } {
  const TEST_DB_PATH = path.join(DB_DIR, "test_database.db");
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  resetDbCache();
  let copied = false;
  if (fs.existsSync(PROD_DB_PATH)) {
    fs.copyFileSync(PROD_DB_PATH, TEST_DB_PATH);
    copied = true;
  }
  writeLocalModeFile("test");
  _activeMode = "test";
  return { copied };
}

function exitTestModeLocal(action: "discard" | "commit"): void {
  const TEST_DB_PATH = path.join(DB_DIR, "test_database.db");
  resetDbCache();
  if (action === "commit" && fs.existsSync(TEST_DB_PATH)) {
    fs.copyFileSync(TEST_DB_PATH, PROD_DB_PATH);
  }
  for (const p of [TEST_DB_PATH, TEST_DB_PATH + "-wal", TEST_DB_PATH + "-shm"]) {
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
  }
  writeLocalModeFile("prod");
  _activeMode = "prod";
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
      try {
        await client.execute({
          sql: `CREATE TABLE IF NOT EXISTS _app_state (key TEXT PRIMARY KEY, value TEXT)`,
        });
      } catch {}
    }
  }
  initSchema();
}

export async function syncTursoIfConfigured(): Promise<void> {
  return;
}

// ─────────────────────────── Readiness ───────────────────────────

let _readyPromise: Promise<void> | null = null;
let _snapshotReady = false;
let _readySchema = false;

export async function ensureLocalReady(): Promise<void> {
  // Schema init — one-time per instance.
  if (!_readySchema) {
    if (hasTursoConfig()) {
      await initSchemaAsync();
    } else {
      initSchema();
    }
    _readySchema = true;
  }
  // Refresh mode každý request (s krátkým TTL), abychom detekovali přepnutí.
  const prevMode = _activeMode;
  const mode = await getDbMode();
  if (!_snapshotReady || mode !== prevMode) {
    _activeMode = mode;
    if (hasTursoConfig()) {
      await pullTursoSnapshot(mode);
    }
    _snapshotReady = true;
  }
  void _readyPromise;
}
