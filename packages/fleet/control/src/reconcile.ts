/**
 * Workload convergence — the reconcile decision function.
 *
 * Pure logic: given (declared, installed, supervisor_state), emit a
 * list of actions that would bring actual to desired. The caller
 * executes the actions. Keeping this pure makes it trivially testable.
 *
 * Phase 1 scope: install-if-missing, upgrade-if-mismatched,
 * re-attach-if-drift. No removal, no dependency ordering.
 */

import type {
  WorkloadDeclaration,
  WorkloadInstallRecord,
} from "./types";

export type ReconcileAction =
  | { kind: "install"; declaration: WorkloadDeclaration; reason: "missing" }
  | {
      kind: "install";
      declaration: WorkloadDeclaration;
      reason: "version_mismatch";
      from: string;
    }
  | {
      kind: "reload";
      workloadId: string;
      supervisorLabel: string;
      plistLabel: string;
      reason: "drift";
    };

export interface ReconcileInputs {
  /** Declared workloads for this machine, from control plane config. */
  declared: WorkloadDeclaration[];
  /** Install records from the agent's workloads.db. */
  installed: WorkloadInstallRecord[];
  /** Current launchd service labels that are loaded. */
  loadedLabels: Set<string>;
}

/**
 * Decide what needs to happen. Does not mutate anything.
 */
export function planReconcile(inputs: ReconcileInputs): ReconcileAction[] {
  const actions: ReconcileAction[] = [];
  const installedById = new Map<string, WorkloadInstallRecord>();
  for (const r of inputs.installed) installedById.set(r.workload_id, r);

  for (const decl of inputs.declared) {
    const existing = installedById.get(decl.id);

    if (!existing) {
      actions.push({
        kind: "install",
        declaration: decl,
        reason: "missing",
      });
      continue;
    }

    if (existing.version !== decl.version) {
      actions.push({
        kind: "install",
        declaration: decl,
        reason: "version_mismatch",
        from: existing.version,
      });
      continue;
    }

    // Version matches. Is the supervisor actually running it?
    // Static workloads have no supervisor (empty supervisor_label),
    // so there is nothing to drift — skip the check.
    if (existing.supervisor_label === "") continue;
    if (!inputs.loadedLabels.has(existing.supervisor_label)) {
      actions.push({
        kind: "reload",
        workloadId: existing.workload_id,
        supervisorLabel: existing.supervisor_label,
        plistLabel: existing.supervisor_label,
        reason: "drift",
      });
    }
  }

  // Phase 1 does NOT remove workloads that are installed but no longer
  // declared — operator can use workload.remove explicitly. This keeps
  // the happy path narrow and means we never delete data implicitly.

  return actions;
}
