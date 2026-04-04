import { Database } from "bun:sqlite";
import type {
  Machine,
  MachineStatus,
  AuditEventType,
  AuditEntry,
  ConfigEntry,
  ConfigHistoryEntry,
  HealthReport,
} from "./types";

export class ControlDB {
  private db: Database;

  constructor(path: string = "seed-control.db") {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS machines (
        id TEXT PRIMARY KEY,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        token_hash TEXT,
        arch TEXT,
        platform TEXT,
        memory_gb REAL,
        agent_version TEXT,
        last_seen TEXT,
        last_health TEXT,
        config_version INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT NOT NULL,
        version INTEGER NOT NULL,
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        changed_by TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        event_type TEXT NOT NULL,
        machine_id TEXT,
        issued_by TEXT,
        action TEXT,
        params TEXT,
        result TEXT,
        details TEXT,
        command_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_machine ON audit_log(machine_id);
      CREATE INDEX IF NOT EXISTS idx_audit_command ON audit_log(command_id);
    `);
  }

  // --- Machine Registry ---

  registerMachine(id: string, displayName?: string): Machine {
    const stmt = this.db.prepare(`
      INSERT INTO machines (id, display_name, status)
      VALUES (?, ?, 'pending')
      ON CONFLICT(id) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, machines.display_name),
        updated_at = datetime('now')
      RETURNING *
    `);
    const row = stmt.get(id, displayName ?? null) as any;
    return this.rowToMachine(row);
  }

  getMachine(id: string): Machine | null {
    const row = this.db
      .prepare("SELECT * FROM machines WHERE id = ?")
      .get(id) as any;
    return row ? this.rowToMachine(row) : null;
  }

  listMachines(status?: MachineStatus): Machine[] {
    if (status) {
      return (
        this.db
          .prepare("SELECT * FROM machines WHERE status = ? ORDER BY id")
          .all(status) as any[]
      ).map((r) => this.rowToMachine(r));
    }
    return (
      this.db
        .prepare("SELECT * FROM machines ORDER BY id")
        .all() as any[]
    ).map((r) => this.rowToMachine(r));
  }

  approveMachine(id: string, tokenHash: string): Machine | null {
    const stmt = this.db.prepare(`
      UPDATE machines
      SET status = 'accepted', token_hash = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'
      RETURNING *
    `);
    const row = stmt.get(tokenHash, id) as any;
    return row ? this.rowToMachine(row) : null;
  }

  revokeMachine(id: string): Machine | null {
    const stmt = this.db.prepare(`
      UPDATE machines
      SET status = 'revoked', token_hash = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'accepted'
      RETURNING *
    `);
    const row = stmt.get(id) as any;
    return row ? this.rowToMachine(row) : null;
  }

  /** Validate a machine token. Returns the machine if token matches an accepted machine. */
  validateToken(machineId: string, tokenHash: string): Machine | null {
    const row = this.db
      .prepare(
        "SELECT * FROM machines WHERE id = ? AND status = 'accepted' AND token_hash = ?"
      )
      .get(machineId, tokenHash) as any;
    return row ? this.rowToMachine(row) : null;
  }

  updateMachineInfo(
    id: string,
    info: {
      arch?: string;
      platform?: string;
      memory_gb?: number;
      agent_version?: string;
      config_version?: number;
    }
  ): void {
    const sets: string[] = ["updated_at = datetime('now')", "last_seen = datetime('now')"];
    const params: any[] = [];

    if (info.arch !== undefined) {
      sets.push("arch = ?");
      params.push(info.arch);
    }
    if (info.platform !== undefined) {
      sets.push("platform = ?");
      params.push(info.platform);
    }
    if (info.memory_gb !== undefined) {
      sets.push("memory_gb = ?");
      params.push(info.memory_gb);
    }
    if (info.agent_version !== undefined) {
      sets.push("agent_version = ?");
      params.push(info.agent_version);
    }
    if (info.config_version !== undefined) {
      sets.push("config_version = ?");
      params.push(info.config_version);
    }

    params.push(id);
    this.db
      .prepare(`UPDATE machines SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);
  }

  updateLastSeen(id: string): void {
    this.db
      .prepare(
        "UPDATE machines SET last_seen = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      )
      .run(id);
  }

  updateLastHealth(id: string, health: HealthReport): void {
    this.db
      .prepare(
        "UPDATE machines SET last_health = ?, last_seen = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      )
      .run(JSON.stringify(health), id);
  }

  updateConfigVersion(id: string, version: number): void {
    this.db
      .prepare(
        "UPDATE machines SET config_version = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(version, id);
  }

  // --- Config Store ---

  getConfig(key: string): ConfigEntry | null {
    const row = this.db
      .prepare("SELECT * FROM config WHERE key = ?")
      .get(key) as any;
    if (!row) return null;
    return {
      ...row,
      value: JSON.parse(row.value),
    };
  }

  getAllConfig(): ConfigEntry[] {
    return (this.db.prepare("SELECT * FROM config ORDER BY key").all() as any[]).map(
      (row) => ({
        ...row,
        value: JSON.parse(row.value),
      })
    );
  }

  getConfigVersion(): number {
    const row = this.db
      .prepare("SELECT MAX(version) as max_version FROM config")
      .get() as any;
    return row?.max_version ?? 0;
  }

  setConfig(key: string, value: unknown, updatedBy: string): ConfigEntry {
    const existing = this.getConfig(key);
    const newVersion = (existing?.version ?? 0) + 1;
    const valueStr = JSON.stringify(value);

    this.db
      .prepare(
        `INSERT INTO config (key, value, version, updated_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           version = excluded.version,
           updated_at = datetime('now'),
           updated_by = excluded.updated_by`
      )
      .run(key, valueStr, newVersion, updatedBy);

    // Record history
    this.db
      .prepare(
        `INSERT INTO config_history (key, old_value, new_value, version, changed_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        key,
        existing ? JSON.stringify(existing.value) : null,
        valueStr,
        newVersion,
        updatedBy
      );

    return this.getConfig(key)!;
  }

  getConfigHistory(key?: string, limit: number = 50): ConfigHistoryEntry[] {
    if (key) {
      return (
        this.db
          .prepare(
            "SELECT * FROM config_history WHERE key = ? ORDER BY id DESC LIMIT ?"
          )
          .all(key, limit) as any[]
      ).map((row) => ({
        ...row,
        old_value: row.old_value ? JSON.parse(row.old_value) : null,
        new_value: JSON.parse(row.new_value),
      }));
    }
    return (
      this.db
        .prepare("SELECT * FROM config_history ORDER BY id DESC LIMIT ?")
        .all(limit) as any[]
    ).map((row) => ({
      ...row,
      old_value: row.old_value ? JSON.parse(row.old_value) : null,
      new_value: JSON.parse(row.new_value),
    }));
  }

  // --- Audit Log ---

  audit(entry: {
    event_type: AuditEventType;
    machine_id?: string;
    issued_by?: string;
    action?: string;
    params?: Record<string, unknown>;
    result?: string;
    details?: string;
    command_id?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (event_type, machine_id, issued_by, action, params, result, details, command_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.event_type,
        entry.machine_id ?? null,
        entry.issued_by ?? null,
        entry.action ?? null,
        entry.params ? JSON.stringify(entry.params) : null,
        entry.result ?? null,
        entry.details ?? null,
        entry.command_id ?? null
      );
  }

  getAuditLog(opts?: {
    machine_id?: string;
    event_type?: AuditEventType;
    limit?: number;
  }): AuditEntry[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (opts?.machine_id) {
      conditions.push("machine_id = ?");
      params.push(opts.machine_id);
    }
    if (opts?.event_type) {
      conditions.push("event_type = ?");
      params.push(opts.event_type);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const limit = opts?.limit ?? 100;

    return this.db
      .prepare(
        `SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?`
      )
      .all(...params, limit) as AuditEntry[];
  }

  // --- Internal ---

  private rowToMachine(row: any): Machine {
    return {
      ...row,
      last_health: row.last_health ? JSON.parse(row.last_health) : null,
    };
  }

  close() {
    this.db.close();
  }
}
