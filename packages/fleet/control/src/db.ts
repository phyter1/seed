import { Database } from "bun:sqlite";
import type {
  Machine,
  MachineStatus,
  AuditEventType,
  AuditEntry,
  ConfigEntry,
  ConfigHistoryEntry,
  HealthReport,
  AgentSession,
  ServiceType,
  SessionStatus,
  HealthLevel,
  StoredAgentEvent,
  EventCategory,
  NormalizedEvent,
  MetricWindow,
  InstallSession,
  InstallEvent,
  InstallTarget,
  InstallStatus,
  InstallEventStatus,
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
        agent_updated_at TEXT,
        lan_ip TEXT,
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

      -- --- Telemetry: Agent Sessions ---
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        service_type TEXT NOT NULL,
        session_kind TEXT NOT NULL DEFAULT 'cli'
          CHECK (session_kind IN ('cli', 'inference')),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'idle', 'stuck', 'stopped', 'crashed', 'completed')),
        health_level TEXT NOT NULL DEFAULT 'green'
          CHECK (health_level IN ('green', 'yellow', 'red')),
        machine_id TEXT,
        current_task TEXT,
        worktree_path TEXT,
        total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
        total_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_cents >= 0),
        context_usage_percent INTEGER NOT NULL DEFAULT 0
          CHECK (context_usage_percent BETWEEN 0 AND 100),
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_event_at TEXT,
        ended_at TEXT,
        end_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_status ON agent_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_service_type ON agent_sessions(service_type);
      CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON agent_sessions(started_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_machine ON agent_sessions(machine_id);

      -- --- Telemetry: Agent Events ---
      CREATE TABLE IF NOT EXISTS agent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL
          REFERENCES agent_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
        service_type TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_name TEXT NOT NULL,
        detail TEXT,
        token_count INTEGER,
        cost_cents INTEGER,
        source TEXT NOT NULL
          CHECK (source IN ('otel', 'hook', 'internal')),
        machine_id TEXT,
        timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON agent_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_session_ts ON agent_events(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON agent_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_type ON agent_events(event_type);

      -- --- Telemetry: Agent Metrics (windowed aggregation) ---
      CREATE TABLE IF NOT EXISTS agent_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL
          REFERENCES agent_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        cost_cents INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_session ON agent_metrics(session_id);
      CREATE INDEX IF NOT EXISTS idx_metrics_window ON agent_metrics(window_start);

      -- --- Install Telemetry ---
      CREATE TABLE IF NOT EXISTS install_sessions (
        install_id TEXT PRIMARY KEY,
        machine_id TEXT,
        target TEXT NOT NULL,
        os TEXT,
        arch TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL,
        steps_total INTEGER,
        steps_completed INTEGER DEFAULT 0,
        last_step TEXT,
        last_error TEXT,
        env TEXT
      );

      CREATE TABLE IF NOT EXISTS install_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        install_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        step TEXT NOT NULL,
        status TEXT NOT NULL,
        details TEXT,
        FOREIGN KEY (install_id) REFERENCES install_sessions(install_id)
      );

      CREATE INDEX IF NOT EXISTS idx_install_events_install_id ON install_events(install_id);
      CREATE INDEX IF NOT EXISTS idx_install_events_timestamp ON install_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_install_sessions_status ON install_sessions(status);
    `);

    // --- Additive migrations for pre-existing databases ---
    this.addColumnIfMissing("machines", "agent_updated_at", "TEXT");
    this.addColumnIfMissing("machines", "lan_ip", "TEXT");
  }

  /**
   * Add a column to a table only if it doesn't already exist. Used to
   * roll forward older databases without dropping data.
   */
  private addColumnIfMissing(
    table: string,
    column: string,
    decl: string
  ): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
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

  /**
   * Register a new machine in pending status with a pre-supplied token hash.
   * Used by the bootstrap flow (`seed fleet join`) where the agent generates
   * its own token client-side and only the hash is sent to the server.
   *
   * Returns null if a machine with the given id already exists.
   */
  registerMachineWithToken(
    id: string,
    tokenHash: string,
    displayName?: string
  ): Machine | null {
    const existing = this.getMachine(id);
    if (existing) return null;
    const stmt = this.db.prepare(`
      INSERT INTO machines (id, display_name, status, token_hash)
      VALUES (?, ?, 'pending', ?)
      RETURNING *
    `);
    const row = stmt.get(id, displayName ?? null, tokenHash) as any;
    return this.rowToMachine(row);
  }

  /**
   * Look up a pending machine by id and verify the token hash matches.
   * Used to authenticate machines that registered via `seed fleet join`
   * but haven't been approved yet — they can maintain a WebSocket
   * connection so the operator can see and approve them, but the
   * control plane won't dispatch commands or push config.
   */
  validatePendingToken(machineId: string, tokenHash: string): Machine | null {
    const row = this.db
      .prepare(
        "SELECT * FROM machines WHERE id = ? AND status = 'pending' AND token_hash = ?"
      )
      .get(machineId, tokenHash) as any;
    return row ? this.rowToMachine(row) : null;
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

  /**
   * Approve a machine that already has a token_hash from `seed fleet join`.
   * Flips status from pending to accepted without touching the token_hash.
   * Returns null if the machine doesn't exist, isn't pending, or has no token_hash.
   */
  approveMachinePreservingToken(id: string): Machine | null {
    const stmt = this.db.prepare(`
      UPDATE machines
      SET status = 'accepted', updated_at = datetime('now')
      WHERE id = ? AND status = 'pending' AND token_hash IS NOT NULL
      RETURNING *
    `);
    const row = stmt.get(id) as any;
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
      lan_ip?: string;
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
      // Only bump agent_updated_at when the reported version actually
      // changes, so operators can tell how long a machine has been
      // running its current version.
      const existing = this.db
        .prepare("SELECT agent_version FROM machines WHERE id = ?")
        .get(id) as { agent_version: string | null } | undefined;
      if (!existing || existing.agent_version !== info.agent_version) {
        sets.push("agent_updated_at = datetime('now')");
      }
    }
    if (info.config_version !== undefined) {
      sets.push("config_version = ?");
      params.push(info.config_version);
    }
    if (info.lan_ip !== undefined) {
      sets.push("lan_ip = ?");
      params.push(info.lan_ip);
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

  // --- Telemetry: Sessions ---

  /**
   * Upsert a session row. If it doesn't exist, creates it. If it does, updates
   * last_event_at (and any provided fields).
   */
  upsertSession(input: {
    id: string;
    service_type: ServiceType;
    session_kind: "cli" | "inference";
    machine_id?: string | null;
    started_at?: string;
    last_event_at?: string;
  }): AgentSession {
    const startedAt = input.started_at ?? new Date().toISOString();
    const lastEventAt = input.last_event_at ?? startedAt;

    this.db
      .prepare(
        `INSERT INTO agent_sessions
           (id, service_type, session_kind, machine_id, started_at, last_event_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           last_event_at = excluded.last_event_at,
           updated_at = datetime('now')`
      )
      .run(
        input.id,
        input.service_type,
        input.session_kind,
        input.machine_id ?? null,
        startedAt,
        lastEventAt
      );

    return this.getSession(input.id)!;
  }

  getSession(id: string): AgentSession | null {
    const row = this.db
      .prepare("SELECT * FROM agent_sessions WHERE id = ?")
      .get(id) as any;
    return row ? this.rowToSession(row) : null;
  }

  listSessions(opts?: {
    service_type?: ServiceType;
    status?: SessionStatus;
    session_kind?: "cli" | "inference";
    limit?: number;
    offset?: number;
  }): { sessions: AgentSession[]; total: number } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (opts?.service_type) {
      conditions.push("service_type = ?");
      params.push(opts.service_type);
    }
    if (opts?.status) {
      conditions.push("status = ?");
      params.push(opts.status);
    }
    if (opts?.session_kind) {
      conditions.push("session_kind = ?");
      params.push(opts.session_kind);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const countRow = this.db
      .prepare(`SELECT COUNT(*) as total FROM agent_sessions ${where}`)
      .get(...params) as any;
    const total = countRow?.total ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM agent_sessions ${where}
         ORDER BY started_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];

    return { sessions: rows.map((r) => this.rowToSession(r)), total };
  }

  updateSessionStatus(
    id: string,
    status: SessionStatus,
    endReason?: string
  ): AgentSession | null {
    const ended = status === "stopped" || status === "crashed" || status === "completed";
    this.db
      .prepare(
        `UPDATE agent_sessions
         SET status = ?,
             ended_at = CASE WHEN ? = 1 THEN datetime('now') ELSE ended_at END,
             end_reason = COALESCE(?, end_reason),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(status, ended ? 1 : 0, endReason ?? null, id);
    return this.getSession(id);
  }

  updateSessionHealth(id: string, health: HealthLevel): void {
    this.db
      .prepare(
        "UPDATE agent_sessions SET health_level = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(health, id);
  }

  updateSessionCurrentTask(id: string, currentTask: string | null): void {
    this.db
      .prepare(
        "UPDATE agent_sessions SET current_task = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(currentTask, id);
  }

  // --- Telemetry: Events ---

  /**
   * Insert a normalized event. Ensures the session row exists (FK) and
   * accumulates token/cost totals on the session.
   */
  insertEvent(event: NormalizedEvent): number {
    // Determine session_kind: inference sources use 'inference', CLI agents use 'cli'
    const sessionKind: "cli" | "inference" =
      event.service_type === "fleet-router" ||
      event.service_type === "inference-worker"
        ? "inference"
        : "cli";

    // Ensure session exists
    this.upsertSession({
      id: event.session_id,
      service_type: event.service_type,
      session_kind: sessionKind,
      machine_id: event.machine_id ?? null,
      started_at: event.timestamp.toISOString(),
      last_event_at: event.timestamp.toISOString(),
    });

    const result = this.db
      .prepare(
        `INSERT INTO agent_events
           (session_id, service_type, event_type, event_name, detail,
            token_count, cost_cents, source, machine_id, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.session_id,
        event.service_type,
        event.event_type,
        event.event_name,
        JSON.stringify(event.detail),
        event.token_count > 0 ? event.token_count : null,
        event.cost_cents > 0 ? event.cost_cents : null,
        event.source,
        event.machine_id ?? null,
        event.timestamp.toISOString()
      );

    // Accumulate token/cost totals on session
    if (event.token_count > 0 || event.cost_cents > 0) {
      this.db
        .prepare(
          `UPDATE agent_sessions
           SET total_tokens = total_tokens + ?,
               total_cost_cents = total_cost_cents + ?,
               last_event_at = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(
          event.token_count,
          event.cost_cents,
          event.timestamp.toISOString(),
          event.session_id
        );
    } else {
      this.db
        .prepare(
          `UPDATE agent_sessions
           SET last_event_at = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(event.timestamp.toISOString(), event.session_id);
    }

    // Replace context_usage_percent if present
    if (event.context_usage_percent !== undefined) {
      this.db
        .prepare(
          `UPDATE agent_sessions
           SET context_usage_percent = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(event.context_usage_percent, event.session_id);
    }

    return Number(result.lastInsertRowid);
  }

  getSessionEvents(
    sessionId: string,
    opts?: { cursor?: number; event_type?: EventCategory; limit?: number }
  ): { events: StoredAgentEvent[]; has_more: boolean; next_cursor: number | null } | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const conditions: string[] = ["session_id = ?"];
    const params: any[] = [sessionId];

    if (opts?.cursor !== undefined) {
      conditions.push("id < ?");
      params.push(opts.cursor);
    }
    if (opts?.event_type) {
      conditions.push("event_type = ?");
      params.push(opts.event_type);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const limit = opts?.limit ?? 50;

    const rows = this.db
      .prepare(
        `SELECT * FROM agent_events ${where}
         ORDER BY id DESC LIMIT ?`
      )
      .all(...params, limit + 1) as any[];

    const has_more = rows.length > limit;
    const sliced = has_more ? rows.slice(0, limit) : rows;
    const events = sliced.map((r) => this.rowToEvent(r));
    const next_cursor = has_more && events.length
      ? events[events.length - 1].id
      : null;

    return { events, has_more, next_cursor };
  }

  /**
   * Insert a metric window. Used by the cost aggregator.
   */
  insertMetricWindow(window: Omit<MetricWindow, "id">): number {
    const result = this.db
      .prepare(
        `INSERT INTO agent_metrics
           (session_id, window_start, window_end, token_count, cost_cents, event_count)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        window.session_id,
        window.window_start,
        window.window_end,
        window.token_count,
        window.cost_cents,
        window.event_count
      );
    return Number(result.lastInsertRowid);
  }

  /** Cost summary: today/week/month totals. */
  getCostSummary(): {
    today: { tokens: number; cost_cents: number };
    week: { tokens: number; cost_cents: number };
    month: { tokens: number; cost_cents: number };
  } {
    const row = this.db
      .prepare(
        `SELECT
           CAST(COALESCE(SUM(CASE WHEN window_start >= datetime('now', 'start of day') THEN token_count ELSE 0 END), 0) AS INTEGER) AS today_tokens,
           CAST(COALESCE(SUM(CASE WHEN window_start >= datetime('now', 'start of day') THEN cost_cents  ELSE 0 END), 0) AS INTEGER) AS today_cost,
           CAST(COALESCE(SUM(CASE WHEN window_start >= datetime('now', '-7 days') THEN token_count ELSE 0 END), 0) AS INTEGER) AS week_tokens,
           CAST(COALESCE(SUM(CASE WHEN window_start >= datetime('now', '-7 days') THEN cost_cents  ELSE 0 END), 0) AS INTEGER) AS week_cost,
           CAST(COALESCE(SUM(CASE WHEN window_start >= datetime('now', '-30 days') THEN token_count ELSE 0 END), 0) AS INTEGER) AS month_tokens,
           CAST(COALESCE(SUM(CASE WHEN window_start >= datetime('now', '-30 days') THEN cost_cents  ELSE 0 END), 0) AS INTEGER) AS month_cost
         FROM agent_metrics`
      )
      .get() as any;

    return {
      today: { tokens: row?.today_tokens ?? 0, cost_cents: row?.today_cost ?? 0 },
      week: { tokens: row?.week_tokens ?? 0, cost_cents: row?.week_cost ?? 0 },
      month: { tokens: row?.month_tokens ?? 0, cost_cents: row?.month_cost ?? 0 },
    };
  }

  /** Cost breakdown by session or service_type for a period. */
  getCostBreakdown(
    period: "today" | "week" | "month" | "all",
    groupBy: "session" | "service_type"
  ): {
    period: string;
    total_tokens: number;
    total_cost_cents: number;
    breakdown: Array<{
      group_key: string;
      tokens: number;
      cost_cents: number;
      percentage: number;
    }>;
  } {
    const periodExpr: Record<string, string | null> = {
      today: "datetime('now', 'start of day')",
      week: "datetime('now', '-7 days')",
      month: "datetime('now', '-30 days')",
      all: null,
    };
    const startExpr = periodExpr[period];
    const periodFilter = startExpr ? `AND am.window_start >= ${startExpr}` : "";

    const totalsRow = this.db
      .prepare(
        `SELECT
           CAST(COALESCE(SUM(token_count), 0) AS INTEGER) AS total_tokens,
           CAST(COALESCE(SUM(cost_cents), 0) AS INTEGER) AS total_cost_cents
         FROM agent_metrics am WHERE 1=1 ${periodFilter}`
      )
      .get() as any;
    const total_tokens = totalsRow?.total_tokens ?? 0;
    const total_cost_cents = totalsRow?.total_cost_cents ?? 0;

    let breakdownSql: string;
    if (groupBy === "session") {
      breakdownSql = `
        SELECT
          am.session_id AS group_key,
          CAST(SUM(am.token_count) AS INTEGER) AS tokens,
          CAST(SUM(am.cost_cents) AS INTEGER) AS cost_cents
        FROM agent_metrics am
        WHERE 1=1 ${periodFilter}
        GROUP BY am.session_id
        ORDER BY cost_cents DESC`;
    } else {
      breakdownSql = `
        SELECT
          s.service_type AS group_key,
          CAST(SUM(am.token_count) AS INTEGER) AS tokens,
          CAST(SUM(am.cost_cents) AS INTEGER) AS cost_cents
        FROM agent_metrics am
        JOIN agent_sessions s ON s.id = am.session_id
        WHERE 1=1 ${periodFilter}
        GROUP BY s.service_type
        ORDER BY cost_cents DESC`;
    }

    const rows = this.db.prepare(breakdownSql).all() as any[];
    const breakdown = rows.map((r) => ({
      group_key: String(r.group_key),
      tokens: r.tokens,
      cost_cents: r.cost_cents,
      percentage:
        total_cost_cents > 0
          ? Math.round((r.cost_cents / total_cost_cents) * 1000) / 10
          : 0,
    }));

    return { period, total_tokens, total_cost_cents, breakdown };
  }

  /** For anomaly detection: session token rates over a lookback window. */
  getSessionTokenRates(
    lookbackMinutes: number,
    minDurationMinutes: number
  ): Array<{
    session_id: string;
    total_tokens: number;
    total_cost_cents: number;
    duration_minutes: number;
    tokens_per_minute: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT
           am.session_id,
           CAST(SUM(am.token_count) AS INTEGER) AS total_tokens,
           CAST(SUM(am.cost_cents) AS INTEGER) AS total_cost_cents,
           CAST((JULIANDAY(MAX(am.window_end)) - JULIANDAY(MIN(am.window_start))) * 24.0 * 60.0 AS REAL) AS duration_minutes
         FROM agent_metrics am
         JOIN agent_sessions s ON s.id = am.session_id
         WHERE s.status IN ('active', 'idle')
           AND am.window_start >= datetime('now', '-' || ? || ' minutes')
         GROUP BY am.session_id
         HAVING duration_minutes >= ?`
      )
      .all(lookbackMinutes, minDurationMinutes) as any[];

    return rows.map((r) => ({
      session_id: r.session_id,
      total_tokens: r.total_tokens,
      total_cost_cents: r.total_cost_cents,
      duration_minutes: r.duration_minutes,
      tokens_per_minute:
        r.duration_minutes > 0 ? r.total_tokens / r.duration_minutes : 0,
    }));
  }

  // --- Internal ---

  private rowToSession(row: any): AgentSession {
    return {
      id: row.id,
      service_type: row.service_type,
      session_kind: row.session_kind,
      status: row.status,
      health_level: row.health_level,
      machine_id: row.machine_id,
      current_task: row.current_task,
      worktree_path: row.worktree_path,
      total_tokens: row.total_tokens,
      total_cost_cents: row.total_cost_cents,
      context_usage_percent: row.context_usage_percent,
      started_at: row.started_at,
      last_event_at: row.last_event_at,
      ended_at: row.ended_at,
      end_reason: row.end_reason,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private rowToEvent(row: any): StoredAgentEvent {
    return {
      id: row.id,
      session_id: row.session_id,
      service_type: row.service_type,
      event_type: row.event_type,
      event_name: row.event_name,
      detail: row.detail ? JSON.parse(row.detail) : null,
      token_count: row.token_count,
      cost_cents: row.cost_cents,
      source: row.source,
      machine_id: row.machine_id,
      timestamp: row.timestamp,
      created_at: row.created_at,
    };
  }

  private rowToMachine(row: any): Machine {
    return {
      ...row,
      last_health: row.last_health ? JSON.parse(row.last_health) : null,
    };
  }

  // --- Install Telemetry ---

  createInstallSession(input: {
    install_id: string;
    machine_id?: string | null;
    target: InstallTarget;
    os?: string | null;
    arch?: string | null;
    env?: Record<string, unknown> | null;
    started_at?: string;
  }): InstallSession {
    const startedAt = input.started_at ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO install_sessions
           (install_id, machine_id, target, os, arch, started_at, status, env)
         VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?)
         ON CONFLICT(install_id) DO NOTHING`
      )
      .run(
        input.install_id,
        input.machine_id ?? null,
        input.target,
        input.os ?? null,
        input.arch ?? null,
        startedAt,
        input.env ? JSON.stringify(input.env) : null
      );
    return this.getInstallSession(input.install_id)!;
  }

  recordInstallEvent(input: {
    install_id: string;
    step: string;
    status: InstallEventStatus;
    details?: Record<string, unknown> | null;
    timestamp?: string;
  }): InstallEvent {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO install_events (install_id, timestamp, step, status, details)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.install_id,
        timestamp,
        input.step,
        input.status,
        input.details ? JSON.stringify(input.details) : null
      );
    return {
      id: Number(result.lastInsertRowid),
      install_id: input.install_id,
      timestamp,
      step: input.step,
      status: input.status,
      details: input.details ?? null,
    };
  }

  updateInstallSession(
    install_id: string,
    updates: {
      machine_id?: string | null;
      status?: InstallStatus;
      steps_total?: number | null;
      steps_completed?: number;
      last_step?: string | null;
      last_error?: string | null;
      completed_at?: string | null;
    }
  ): InstallSession | null {
    const sets: string[] = [];
    const params: any[] = [];

    if (updates.machine_id !== undefined) {
      sets.push("machine_id = ?");
      params.push(updates.machine_id);
    }
    if (updates.status !== undefined) {
      sets.push("status = ?");
      params.push(updates.status);
    }
    if (updates.steps_total !== undefined) {
      sets.push("steps_total = ?");
      params.push(updates.steps_total);
    }
    if (updates.steps_completed !== undefined) {
      sets.push("steps_completed = ?");
      params.push(updates.steps_completed);
    }
    if (updates.last_step !== undefined) {
      sets.push("last_step = ?");
      params.push(updates.last_step);
    }
    if (updates.last_error !== undefined) {
      sets.push("last_error = ?");
      params.push(updates.last_error);
    }
    if (updates.completed_at !== undefined) {
      sets.push("completed_at = ?");
      params.push(updates.completed_at);
    }
    if (sets.length === 0) return this.getInstallSession(install_id);
    params.push(install_id);
    this.db
      .prepare(
        `UPDATE install_sessions SET ${sets.join(", ")} WHERE install_id = ?`
      )
      .run(...params);
    return this.getInstallSession(install_id);
  }

  getInstallSession(install_id: string): InstallSession | null {
    const row = this.db
      .prepare("SELECT * FROM install_sessions WHERE install_id = ?")
      .get(install_id) as any;
    return row ? this.rowToInstallSession(row) : null;
  }

  listInstallSessions(opts?: {
    status?: InstallStatus;
    machine_id?: string;
    limit?: number;
  }): InstallSession[] {
    const conditions: string[] = [];
    const params: any[] = [];
    if (opts?.status) {
      conditions.push("status = ?");
      params.push(opts.status);
    }
    if (opts?.machine_id) {
      conditions.push("machine_id = ?");
      params.push(opts.machine_id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts?.limit ?? 50;
    const rows = this.db
      .prepare(
        `SELECT * FROM install_sessions ${where}
         ORDER BY started_at DESC LIMIT ?`
      )
      .all(...params, limit) as any[];
    return rows.map((r) => this.rowToInstallSession(r));
  }

  listInstallEvents(
    install_id: string,
    opts?: { since?: string }
  ): InstallEvent[] {
    const conditions: string[] = ["install_id = ?"];
    const params: any[] = [install_id];
    if (opts?.since) {
      conditions.push("timestamp > ?");
      params.push(opts.since);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM install_events WHERE ${conditions.join(" AND ")}
         ORDER BY id ASC`
      )
      .all(...params) as any[];
    return rows.map((r) => this.rowToInstallEvent(r));
  }

  latestInstallEvent(install_id: string): InstallEvent | null {
    const row = this.db
      .prepare(
        `SELECT * FROM install_events WHERE install_id = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(install_id) as any;
    return row ? this.rowToInstallEvent(row) : null;
  }

  private rowToInstallSession(row: any): InstallSession {
    return {
      install_id: row.install_id,
      machine_id: row.machine_id,
      target: row.target,
      os: row.os,
      arch: row.arch,
      started_at: row.started_at,
      completed_at: row.completed_at,
      status: row.status,
      steps_total: row.steps_total,
      steps_completed: row.steps_completed ?? 0,
      last_step: row.last_step,
      last_error: row.last_error,
      env: row.env ? JSON.parse(row.env) : null,
    };
  }

  private rowToInstallEvent(row: any): InstallEvent {
    return {
      id: row.id,
      install_id: row.install_id,
      timestamp: row.timestamp,
      step: row.step,
      status: row.status,
      details: row.details ? JSON.parse(row.details) : null,
    };
  }

  close() {
    this.db.close();
  }
}
