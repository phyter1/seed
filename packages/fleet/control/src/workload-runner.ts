/**
 * Workload runner — orchestrates the convergence loop on the agent side.
 *
 * Pulls the plan from `planReconcile`, executes each action via the
 * installer, updates the local workloads.db, and returns a summary.
 * This is the single entry point the agent calls on config update
 * and on `workload.reconcile` command.
 */

import { planReconcile } from "./reconcile";
import { installWorkload } from "./workload-installer";
import type { InstallerOptions } from "./workload-installer";
import type { WorkloadDB } from "./workload-db";
import type { SupervisorDriver } from "./supervisors/launchd";
import type {
  WorkloadDeclaration,
  WorkloadInstallRecord,
} from "./types";

export interface RunnerDeps {
  db: WorkloadDB;
  driver: SupervisorDriver;
  installerOpts: InstallerOptions;
  /** Logger — defaults to console.log with [workloads] prefix. */
  log?: (msg: string) => void;
}

export interface ReconcileSummary {
  installed: string[];
  upgraded: string[];
  reloaded: string[];
  failed: Array<{ workload_id: string; error: string }>;
  skipped: string[];
}

async function listLoadedLabels(driver: SupervisorDriver, records: WorkloadInstallRecord[]): Promise<Set<string>> {
  // We only need to know about labels we care about. Query status
  // per-record to avoid parsing `launchctl list` (no label filter).
  // Static workloads have no label — skip them.
  const loaded = new Set<string>();
  for (const r of records) {
    if (r.supervisor_label === "") continue;
    if (await driver.isLoaded(r.supervisor_label)) {
      loaded.add(r.supervisor_label);
    }
  }
  return loaded;
}

export async function reconcile(
  declared: WorkloadDeclaration[],
  deps: RunnerDeps
): Promise<ReconcileSummary> {
  const log = deps.log ?? ((m) => console.log(`[workloads] ${m}`));
  const summary: ReconcileSummary = {
    installed: [],
    upgraded: [],
    reloaded: [],
    failed: [],
    skipped: [],
  };

  const installedRecords = deps.db.list();
  const loadedLabels = await listLoadedLabels(deps.driver, installedRecords);
  const actions = planReconcile({
    declared,
    installed: installedRecords,
    loadedLabels,
  });

  if (actions.length === 0) {
    log(`reconcile: no actions (${declared.length} declared, ${installedRecords.length} installed)`);
    for (const d of declared) summary.skipped.push(d.id);
    return summary;
  }

  log(`reconcile: executing ${actions.length} action(s)`);

  for (const action of actions) {
    if (action.kind === "install") {
      const decl = action.declaration;
      try {
        log(`install ${decl.id}@${decl.version} (${action.reason})`);
        const result = await installWorkload(decl, deps.installerOpts);
        deps.db.upsert(result.record);
        if (action.reason === "missing") {
          summary.installed.push(decl.id);
        } else {
          summary.upgraded.push(decl.id);
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        log(`install FAILED ${decl.id}@${decl.version}: ${msg}`);
        deps.db.upsert({
          workload_id: decl.id,
          version: decl.version,
          install_dir: "",
          supervisor_label: "",
          installed_at: new Date().toISOString(),
          state: "install_failed",
          failure_reason: msg,
          last_probe_at: null,
          last_probe_tier: null,
        });
        summary.failed.push({ workload_id: decl.id, error: msg });
      }
      continue;
    }

    if (action.kind === "reload") {
      try {
        log(`reload ${action.workloadId} (${action.reason})`);
        // Plist is already on disk at the per-user LaunchAgents
        // directory; re-bootstrap it.
        const homeDir = process.env.HOME ?? "";
        const plistPath = `${homeDir}/Library/LaunchAgents/${action.supervisorLabel}.plist`;
        await deps.driver.load(action.supervisorLabel, plistPath);
        deps.db.updateState(action.workloadId, "loaded", null);
        summary.reloaded.push(action.workloadId);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        log(`reload FAILED ${action.workloadId}: ${msg}`);
        deps.db.updateState(action.workloadId, "install_failed", msg);
        summary.failed.push({
          workload_id: action.workloadId,
          error: msg,
        });
      }
    }
  }

  return summary;
}
