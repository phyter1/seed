/**
 * Tests for config reload — hot topology updates without router restart.
 *
 * Verifies:
 * - reloadConfig() returns a valid summary with added/removed models and machines
 * - After reload, FLEET reflects the new config
 * - Machine queues for existing machines are preserved (not reset)
 * - New machines get new queues, removed machines' queues are cleaned up
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import type { ModelEntry } from "./types";
import type { LoadedRouterConfig } from "./config";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(fleet: ModelEntry[], source: "seed" | "legacy" | "env" = "seed"): LoadedRouterConfig {
  const ollamaEntries = fleet.filter(e => e.provider === "ollama");
  const ollamaMachineMap = new Map<string, string>();
  for (const e of ollamaEntries) {
    ollamaMachineMap.set(e.machine, e.host);
  }
  return {
    routerModel: "test-model",
    routerPort: 3000,
    fleet,
    mlxHost: "localhost:8080",
    mlxPythonPath: "python3",
    mlxStarterPath: "/fake/start-mlx-server.py",
    mlxModel: "test-mlx-model",
    ollamaMachines: Array.from(ollamaMachineMap.entries()).map(([name, host]) => ({ name, host })),
    allMachineNames: Array.from(new Set(fleet.map(e => e.machine))),
    source,
  };
}

function makeEntry(machine: string, model: string, provider: ModelEntry["provider"] = "ollama", priority = 1): ModelEntry {
  return {
    machine,
    host: `${machine}.local:${provider === "ollama" ? "11434" : "8080"}`,
    provider,
    model,
    tags: ["general"],
    priority,
    locality: "local",
  };
}

// ── Mock Setup ─────────────────────────────────────────────────────────────

let callCount = 0;
let configs: LoadedRouterConfig[] = [];

const mockLoadRouterConfig = mock(() => {
  return configs[callCount++] ?? configs[configs.length - 1];
});

// Intercept config module before state.ts imports it
mock.module("./config", () => ({
  loadRouterConfig: mockLoadRouterConfig,
}));

// Import state after mocking — uses our mocked loadRouterConfig
const { initState, reloadConfig, getFleet, getJuryModels, getAllMachineNames, getOllamaMachines, getMachineQueue, getConfigSource } = await import("./state");

// ── Test Suite ─────────────────────────────────────────────────────────────

describe("config reload", () => {
  beforeEach(() => {
    callCount = 0;
    configs = [];
    mockLoadRouterConfig.mockClear();
  });

  test("reloadConfig returns a valid summary with fleet size", () => {
    const initial = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    const updated = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren2", "gemma4:e4b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    configs = [initial, updated];

    initState();
    expect(getFleet()).toHaveLength(2);

    const summary = reloadConfig();

    expect(summary.reloaded).toBe(true);
    expect(summary.fleet_size).toBe(3);
    expect(summary.changes.added_models).toContain("ren2/gemma4:e4b");
    expect(summary.changes.removed_models).toHaveLength(0);
  });

  test("after reload, FLEET reflects the new config", () => {
    const initial = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
    ]);
    const updated = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren2", "gemma4:e4b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    configs = [initial, updated];

    initState();
    expect(getFleet()).toHaveLength(1);

    reloadConfig();

    const fleet = getFleet();
    expect(fleet).toHaveLength(3);
    expect(fleet.map(f => f.machine).sort()).toEqual(["ren1", "ren2", "ren3"]);
  });

  test("machine queues for existing machines are preserved (not reset)", () => {
    const initial = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    const updated = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren2", "gemma4:e4b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    configs = [initial, updated];

    initState();

    const queueBefore = getMachineQueue("ren1");
    expect(queueBefore).toBeDefined();

    reloadConfig();

    const queueAfter = getMachineQueue("ren1");
    expect(queueAfter).toBe(queueBefore);
  });

  test("new machines get new queues, removed machines' queues are cleaned up", () => {
    const initial = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    const updated = makeConfig([
      makeEntry("ren2", "gemma4:e4b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    configs = [initial, updated];

    initState();

    expect(getMachineQueue("ren1")).toBeDefined();
    expect(getMachineQueue("ren2")).toBeUndefined();

    const summary = reloadConfig();

    expect(getMachineQueue("ren2")).toBeDefined();
    expect(getMachineQueue("ren1")).toBeUndefined();

    expect(summary.changes.added_machines).toContain("ren2");
    expect(summary.changes.removed_machines).toContain("ren1");
  });

  test("removed models appear in the summary", () => {
    const initial = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren2", "gemma4:e4b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    const updated = makeConfig([
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    configs = [initial, updated];

    initState();
    const summary = reloadConfig();

    expect(summary.changes.removed_models).toContain("ren1/gemma4:e2b");
    expect(summary.changes.removed_models).toContain("ren2/gemma4:e4b");
    expect(summary.fleet_size).toBe(1);
  });

  test("JURY_MODELS is updated after reload", () => {
    const initial = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    const updated = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren2", "gemma4:e4b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    configs = [initial, updated];

    initState();
    expect(getJuryModels()).toHaveLength(1);

    reloadConfig();
    expect(getJuryModels()).toHaveLength(2);
  });

  test("ALL_MACHINE_NAMES is updated after reload", () => {
    const initial = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
    ]);
    const updated = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren2", "gemma4:e4b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    configs = [initial, updated];

    initState();
    expect(getAllMachineNames()).toEqual(["ren1"]);

    reloadConfig();
    expect(getAllMachineNames().sort()).toEqual(["ren1", "ren2", "ren3"]);
  });

  test("OLLAMA_MACHINES is updated after reload", () => {
    const initial = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    const updated = makeConfig([
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren2", "gemma4:e4b"),
      makeEntry("ren3", "qwen3.5-9b", "openai_compatible"),
    ]);
    configs = [initial, updated];

    initState();
    expect(getOllamaMachines()).toHaveLength(1);

    reloadConfig();
    expect(getOllamaMachines()).toHaveLength(2);
  });
});
