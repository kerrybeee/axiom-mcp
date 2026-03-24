/**
 * AXIOM — SQLite persistence layer (sql.js, pure WASM, no native compile)
 * Stores sessions and receipts. Survives process restarts.
 */
import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "axiom.db");

let db: Database;

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      mission TEXT,
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      decision TEXT NOT NULL,
      tool TEXT,
      context TEXT,
      tags TEXT,
      ctx_hash TEXT NOT NULL,
      out_hash TEXT NOT NULL,
      drift REAL NOT NULL,
      PRIMARY KEY (id, session_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_session ON receipts(session_id);
    CREATE INDEX IF NOT EXISTS idx_receipts_tool ON receipts(tool);
    CREATE INDEX IF NOT EXISTS idx_receipts_drift ON receipts(drift);
    CREATE TABLE IF NOT EXISTS policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      session_id TEXT,
      condition TEXT NOT NULL,
      action TEXT NOT NULL,
      threshold REAL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_policies_scope ON policies(scope);
    CREATE INDEX IF NOT EXISTS idx_policies_session ON policies(session_id);
    CREATE TABLE IF NOT EXISTS session_control (
      session_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      reason TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);
  persist();
}

export function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Session ──────────────────────────────────────────────────────────────────

export function insertSession(id: string, startedAt: string, mission?: string) {
  db.run("INSERT OR REPLACE INTO sessions VALUES (?,?,?,NULL)", [id, startedAt, mission ?? null]);
  persist();
}

export function endSession(id: string) {
  db.run("UPDATE sessions SET ended_at=? WHERE id=?", [new Date().toISOString(), id]);
  persist();
}

export function getSessions(limit = 20): SessionRow[] {
  const stmt = db.prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?");
  stmt.bind([limit]);
  const rows: SessionRow[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as unknown as SessionRow);
  stmt.free();
  return rows;
}

export function findSession(idOrPrefix: string): SessionRow | null {
  const stmt = db.prepare(
    "SELECT * FROM sessions WHERE id = ? OR id LIKE ? ORDER BY started_at DESC LIMIT 1",
  );
  stmt.bind([idOrPrefix, `${idOrPrefix}%`]);
  const found = stmt.step() ? (stmt.getAsObject() as unknown as SessionRow) : null;
  stmt.free();
  return found;
}

export interface SessionRow {
  id: string; started_at: string; mission: string | null; ended_at: string | null;
}

export interface PolicyInsert {
  name: string;
  scope: "global" | "session";
  sessionId?: string | null;
  condition: string;
  action: string;
  threshold?: number | null;
  enabled?: boolean;
}

export interface PolicyRow {
  id: number;
  name: string;
  scope: "global" | "session";
  session_id: string | null;
  condition: string;
  action: string;
  threshold: number | null;
  enabled: number;
  created_at: string;
}

export interface SessionControlRow {
  session_id: string;
  state: "active" | "watch" | "blocked";
  reason: string | null;
  updated_at: string;
}

export function insertPolicy(policy: PolicyInsert): number {
  db.run(
    "INSERT INTO policies (name, scope, session_id, condition, action, threshold, enabled, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [
      policy.name,
      policy.scope,
      policy.sessionId ?? null,
      policy.condition,
      policy.action,
      policy.threshold ?? null,
      policy.enabled === false ? 0 : 1,
      new Date().toISOString(),
    ],
  );
  const stmt = db.prepare("SELECT last_insert_rowid() as id");
  stmt.step();
  const id = (stmt.getAsObject() as { id: number }).id;
  stmt.free();
  persist();
  return id;
}

export function getPolicies(opts: {
  scope?: "global" | "session";
  sessionId?: string;
  enabledOnly?: boolean;
} = {}): PolicyRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (opts.scope) {
    conditions.push("scope=?");
    params.push(opts.scope);
  }
  if (opts.sessionId) {
    conditions.push("(scope='global' OR session_id=?)");
    params.push(opts.sessionId);
  }
  if (opts.enabledOnly) {
    conditions.push("enabled=1");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const stmt = db.prepare(`SELECT * FROM policies ${where} ORDER BY id ASC`);
  stmt.bind(params);
  const rows: PolicyRow[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as unknown as PolicyRow);
  stmt.free();
  return rows;
}

export function findPolicy(id: number): PolicyRow | null {
  const stmt = db.prepare("SELECT * FROM policies WHERE id=? LIMIT 1");
  stmt.bind([id]);
  const row = stmt.step() ? (stmt.getAsObject() as unknown as PolicyRow) : null;
  stmt.free();
  return row;
}

export function setPolicyEnabled(id: number, enabled: boolean): void {
  db.run("UPDATE policies SET enabled=? WHERE id=?", [enabled ? 1 : 0, id]);
  persist();
}

export function deletePolicy(id: number): void {
  db.run("DELETE FROM policies WHERE id=?", [id]);
  persist();
}

export function getSessionControl(sessionId: string): SessionControlRow {
  const stmt = db.prepare("SELECT * FROM session_control WHERE session_id=? LIMIT 1");
  stmt.bind([sessionId]);
  const row = stmt.step() ? (stmt.getAsObject() as unknown as SessionControlRow) : null;
  stmt.free();
  if (row) return row;
  return {
    session_id: sessionId,
    state: "active",
    reason: null,
    updated_at: new Date(0).toISOString(),
  };
}

export function setSessionControl(sessionId: string, state: "active" | "watch" | "blocked", reason?: string | null): void {
  db.run(
    "INSERT OR REPLACE INTO session_control (session_id, state, reason, updated_at) VALUES (?,?,?,?)",
    [sessionId, state, reason ?? null, new Date().toISOString()],
  );
  persist();
}

// ── Receipt ───────────────────────────────────────────────────────────────────

export function insertReceipt(sessionId: string, r: ReceiptInsert) {
  db.run(
    "INSERT INTO receipts VALUES (?,?,?,?,?,?,?,?,?,?)",
    [r.id, sessionId, r.timestamp, r.decision, r.tool ?? null, r.context ?? null,
     r.tags ? JSON.stringify(r.tags) : null, r.ctxHash, r.outHash, r.drift]
  );
  persist();
}

export function getReceipts(sessionId: string, opts: { limit?: number; minDrift?: number } = {}): ReceiptRow[] {
  let sql = "SELECT * FROM receipts WHERE session_id=?";
  const params: (string | number)[] = [sessionId];
  if (opts.minDrift !== undefined) { sql += " AND drift>=?"; params.push(opts.minDrift); }
  sql += " ORDER BY id ASC";
  if (opts.limit) { sql += " LIMIT ?"; params.push(opts.limit); }
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: ReceiptRow[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as ReceiptRow;
    rows.push(row);
  }
  stmt.free();
  return rows;
}

export function searchReceipts(opts: {
  keyword?: string; tag?: string; tool?: string;
  sessionId?: string; minDrift?: number; since?: string; limit?: number;
}): ReceiptRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (opts.sessionId) { conditions.push("session_id=?"); params.push(opts.sessionId); }
  if (opts.keyword) { conditions.push("(decision LIKE ? OR context LIKE ?)"); params.push(`%${opts.keyword}%`, `%${opts.keyword}%`); }
  if (opts.tag) { conditions.push("tags LIKE ?"); params.push(`%${opts.tag}%`); }
  if (opts.tool) { conditions.push("tool=?"); params.push(opts.tool); }
  if (opts.minDrift !== undefined) { conditions.push("drift>=?"); params.push(opts.minDrift); }
  if (opts.since) { conditions.push("timestamp>=?"); params.push(opts.since); }
  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const sql = `SELECT * FROM receipts ${where} ORDER BY timestamp DESC LIMIT ?`;
  params.push(opts.limit ?? 50);
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: ReceiptRow[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as unknown as ReceiptRow);
  stmt.free();
  return rows;
}

export function getToolHistory(sessionId: string): string[] {
  const stmt = db.prepare("SELECT tool FROM receipts WHERE session_id=? AND tool IS NOT NULL ORDER BY id ASC");
  stmt.bind([sessionId]);
  const tools: string[] = [];
  while (stmt.step()) tools.push((stmt.getAsObject() as { tool: string }).tool);
  stmt.free();
  return tools;
}

export function countReceipts(sessionId: string): number {
  const stmt = db.prepare("SELECT COUNT(*) as n FROM receipts WHERE session_id=?");
  stmt.bind([sessionId]);
  stmt.step();
  const n = (stmt.getAsObject() as { n: number }).n;
  stmt.free();
  return n;
}

export interface ReceiptInsert {
  id: number; timestamp: string; decision: string;
  tool?: string; context?: string; tags?: string[];
  ctxHash: string; outHash: string; drift: number;
}
export interface ReceiptRow {
  id: number; session_id: string; timestamp: string; decision: string;
  tool: string | null; context: string | null; tags: string | null;
  ctx_hash: string; out_hash: string; drift: number;
}
