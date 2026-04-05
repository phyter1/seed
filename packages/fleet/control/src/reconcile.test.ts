import { describe, test, expect } from "bun:test";
import { planReconcile } from "./reconcile";
import type { WorkloadDeclaration, WorkloadInstallRecord } from "./types";

function decl(id: string, version: string): WorkloadDeclaration {
  return {
    id,
    version,
    artifact_url: `file:///tmp/${id}-${version}.tar.gz`,
  };
}

function installed(
  id: string,
  version: string,
  label = `com.seed.${id}`
): WorkloadInstallRecord {
  return {
    workload_id: id,
    version,
    install_dir: `/tmp/installs/${id}-${version}`,
    supervisor_label: label,
    installed_at: "2026-04-04T00:00:00Z",
    state: "loaded",
    failure_reason: null,
    last_probe_at: null,
    last_probe_tier: null,
  };
}

describe("planReconcile", () => {
  test("nothing declared, nothing installed → no actions", () => {
    const actions = planReconcile({
      declared: [],
      installed: [],
      loadedLabels: new Set(),
    });
    expect(actions).toEqual([]);
  });

  test("declared but not installed → install action with 'missing'", () => {
    const actions = planReconcile({
      declared: [decl("memory", "0.1.0")],
      installed: [],
      loadedLabels: new Set(),
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("install");
    if (actions[0].kind === "install") {
      expect(actions[0].reason).toBe("missing");
      expect(actions[0].declaration.id).toBe("memory");
    }
  });

  test("version mismatch → install with 'version_mismatch' and previous version", () => {
    const actions = planReconcile({
      declared: [decl("memory", "0.2.0")],
      installed: [installed("memory", "0.1.0")],
      loadedLabels: new Set(["com.seed.memory"]),
    });
    expect(actions).toHaveLength(1);
    if (actions[0].kind === "install") {
      expect(actions[0].reason).toBe("version_mismatch");
      if (actions[0].reason === "version_mismatch") {
        expect(actions[0].from).toBe("0.1.0");
      }
    }
  });

  test("installed and loaded at declared version → no action", () => {
    const actions = planReconcile({
      declared: [decl("memory", "0.1.0")],
      installed: [installed("memory", "0.1.0")],
      loadedLabels: new Set(["com.seed.memory"]),
    });
    expect(actions).toEqual([]);
  });

  test("installed but supervisor forgot it (drift) → reload", () => {
    const actions = planReconcile({
      declared: [decl("memory", "0.1.0")],
      installed: [installed("memory", "0.1.0")],
      loadedLabels: new Set(), // empty → drift
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("reload");
    if (actions[0].kind === "reload") {
      expect(actions[0].reason).toBe("drift");
      expect(actions[0].supervisorLabel).toBe("com.seed.memory");
    }
  });

  test("installed but not declared → NO action (Phase 1 is additive)", () => {
    const actions = planReconcile({
      declared: [],
      installed: [installed("memory", "0.1.0")],
      loadedLabels: new Set(["com.seed.memory"]),
    });
    expect(actions).toEqual([]);
  });

  test("multiple workloads, mix of states", () => {
    const actions = planReconcile({
      declared: [decl("memory", "0.1.0"), decl("router", "0.2.0"), decl("mlx", "0.3.0")],
      installed: [
        installed("memory", "0.1.0"), // up to date, loaded
        installed("router", "0.1.0"), // version mismatch
        // mlx missing
      ],
      loadedLabels: new Set(["com.seed.memory", "com.seed.router"]),
    });
    expect(actions).toHaveLength(2);
    const byId = new Map<string, (typeof actions)[number]>();
    for (const a of actions) {
      const key = a.kind === "install" ? a.declaration.id : a.workloadId;
      byId.set(key, a);
    }
    expect(byId.get("mlx")?.kind).toBe("install");
    expect(byId.get("router")?.kind).toBe("install");
    const routerAction = byId.get("router");
    if (routerAction?.kind === "install") {
      expect(routerAction.reason).toBe("version_mismatch");
    }
  });

  test("static workload (empty supervisor_label) never emits drift/reload", () => {
    // A static (file-drop) workload has no supervisor, so an empty
    // loadedLabels set is the correct steady state — it must not be
    // flagged as drift.
    const actions = planReconcile({
      declared: [decl("fleet-topology", "0.1.0")],
      installed: [installed("fleet-topology", "0.1.0", "")],
      loadedLabels: new Set(),
    });
    expect(actions).toEqual([]);
  });

  test("static workload at mismatched version still re-installs", () => {
    const actions = planReconcile({
      declared: [decl("fleet-topology", "0.2.0")],
      installed: [installed("fleet-topology", "0.1.0", "")],
      loadedLabels: new Set(),
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("install");
    if (actions[0]?.kind === "install") {
      expect(actions[0].reason).toBe("version_mismatch");
    }
  });
});
