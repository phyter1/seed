/**
 * Agent-local SQLite store tracking installed workloads. This is a
 * separate database from the control plane's `seed-control.db` — it
 * belongs to the agent, lives next to the cached config, and survives
 * reboots so reconcile can do drift healing on restart.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  WorkloadInstallRecord,
  WorkloadInstallStatus,
} from "./types";

export class WorkloadDB {
  private db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workloads (
        workload_id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        install_dir TEXT NOT NULL,
        supervisor_label TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        state TEXT NOT NULL,
        failure_reason TEXT,
        last_probe_at TEXT,
        last_probe_tier TEXT
      );
    `);
  }

  upsert(record: WorkloadInstallRecord): void {
    this.db
      .prepare(
        `INSERT INTO workloads
           (workload_id, version, install_dir, supervisor_label,
            installed_at, state, failure_reason, last_probe_at, last_probe_tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workload_id) DO UPDATE SET
           version = excluded.version,
           install_dir = excluded.install_dir,
           supervisor_label = excluded.supervisor_label,
           installed_at = excluded.installed_at,
           state = excluded.state,
           failure_reason = excluded.failure_reason,
           last_probe_at = excluded.last_probe_at,
           last_probe_tier = excluded.last_probe_tier`
      )
      .run(
        record.workload_id,
        record.version,
        record.install_dir,
        record.supervisor_label,
        record.installed_at,
        record.state,
        record.failure_reason,
        record.last_probe_at,
        record.last_probe_tier
      );
  }

  get(workloadId: string): WorkloadInstallRecord | null {
    const row = this.db
      .prepare("SELECT * FROM workloads WHERE workload_id = ?")
      .get(workloadId) as any;
    return row ? this.rowToRecord(row) : null;
  }

  list(): WorkloadInstallRecord[] {
    return (
      this.db.prepare("SELECT * FROM workloads ORDER BY workload_id").all() as any[]
    ).map((r) => this.rowToRecord(r));
  }

  updateState(
    workloadId: string,
    state: WorkloadInstallStatus,
    failureReason?: string | null
  ): void {
    this.db
      .prepare(
        "UPDATE workloads SET state = ?, failure_reason = ? WHERE workload_id = ?"
      )
      .run(state, failureReason ?? null, workloadId);
  }

  delete(workloadId: string): void {
    this.db
      .prepare("DELETE FROM workloads WHERE workload_id = ?")
      .run(workloadId);
  }

  close(): void {
    this.db.close();
  }

  private rowToRecord(row: any): WorkloadInstallRecord {
    return {
      workload_id: row.workload_id,
      version: row.version,
      install_dir: row.install_dir,
      supervisor_label: row.supervisor_label,
      installed_at: row.installed_at,
      state: row.state as WorkloadInstallStatus,
      failure_reason: row.failure_reason,
      last_probe_at: row.last_probe_at,
      last_probe_tier: row.last_probe_tier,
    };
  }
}
