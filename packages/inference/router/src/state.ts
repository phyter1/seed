/**
 * Mutable router state — fleet topology, jury models, machine queues.
 *
 * Extracted from router.ts so that reloadConfig() can be tested in isolation
 * without starting the HTTP server or spawning MLX processes.
 *
 * The router imports this module and delegates all topology state through it.
 * The config reload endpoint calls reloadConfig() to hot-swap topology.
 */

import { loadRouterConfig, type LoadedRouterConfig } from "./config";
import type { ModelEntry } from "./types";

// ── Machine Queue ──────────────────────────────────────────────────────────

export interface MachineQueue {
  promise: Promise<void>;
  depth: number;
}

// ── Reload Summary ─────────────────────────────────────────────────────────

export interface ReloadSummary {
  reloaded: true;
  fleet_size: number;
  changes: {
    added_models: string[];
    removed_models: string[];
    added_machines: string[];
    removed_machines: string[];
  };
}

// ── Mutable State ──────────────────────────────────────────────────────────

let FLEET: ModelEntry[] = [];
let JURY_MODELS: ModelEntry[] = [];
let ALL_MACHINE_NAMES: string[] = [];
let OLLAMA_MACHINES: { name: string; host: string }[] = [];
let CONFIG_SOURCE: "seed" | "legacy" | "env" = "seed";

// Immutable config — set once at init, not updated on reload
let ROUTER_PORT = 3000;
let MLX_HOST = "localhost:8080";
let MLX_PYTHON_PATH = "python3";
let MLX_STARTER_PATH = "";
let MLX_MODEL = "";

const machineQueues: Record<string, MachineQueue> = {};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Canonical key for a model entry: "machine/model" */
function modelKey(entry: ModelEntry): string {
  return `${entry.machine}/${entry.model}`;
}

function applyConfig(config: LoadedRouterConfig): void {
  FLEET = config.fleet;
  JURY_MODELS = config.fleet.filter(m => m.provider === "ollama");
  ALL_MACHINE_NAMES = config.allMachineNames;
  OLLAMA_MACHINES = config.ollamaMachines;
  CONFIG_SOURCE = config.source;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize state from config. Called once at router startup.
 * Resets all mutable state (useful in tests).
 */
export function initState(): void {
  const config = loadRouterConfig();
  applyConfig(config);

  // Set immutable config values (only on init, not reload)
  ROUTER_PORT = config.routerPort;
  MLX_HOST = config.mlxHost;
  MLX_PYTHON_PATH = config.mlxPythonPath;
  MLX_STARTER_PATH = config.mlxStarterPath;
  MLX_MODEL = config.mlxModel;

  // Clear and rebuild machine queues
  for (const key of Object.keys(machineQueues)) {
    delete machineQueues[key];
  }
  for (const name of ALL_MACHINE_NAMES) {
    machineQueues[name] = { promise: Promise.resolve(), depth: 0 };
  }
}

/**
 * Reload config from disk and update all mutable state.
 * Preserves machine queues for machines that still exist.
 * Returns a summary of what changed.
 */
export function reloadConfig(): ReloadSummary {
  const oldModelKeys = new Set(FLEET.map(modelKey));
  const oldMachineNames = new Set(ALL_MACHINE_NAMES);

  const config = loadRouterConfig();
  applyConfig(config);

  const newModelKeys = new Set(FLEET.map(modelKey));
  const newMachineNames = new Set(ALL_MACHINE_NAMES);

  // Diff models
  const addedModels = [...newModelKeys].filter(k => !oldModelKeys.has(k));
  const removedModels = [...oldModelKeys].filter(k => !newModelKeys.has(k));

  // Diff machines
  const addedMachines = [...newMachineNames].filter(m => !oldMachineNames.has(m));
  const removedMachines = [...oldMachineNames].filter(m => !newMachineNames.has(m));

  // Update machine queues: add new, remove old, keep existing
  for (const name of addedMachines) {
    machineQueues[name] = { promise: Promise.resolve(), depth: 0 };
  }
  for (const name of removedMachines) {
    delete machineQueues[name];
  }

  // Log changes
  if (addedModels.length > 0) {
    console.log(`[config-reload] added models: ${addedModels.join(", ")}`);
  }
  if (removedModels.length > 0) {
    console.log(`[config-reload] removed models: ${removedModels.join(", ")}`);
  }
  if (addedMachines.length > 0) {
    console.log(`[config-reload] added machines: ${addedMachines.join(", ")}`);
  }
  if (removedMachines.length > 0) {
    console.log(`[config-reload] removed machines: ${removedMachines.join(", ")}`);
  }
  if (addedModels.length === 0 && removedModels.length === 0 && addedMachines.length === 0 && removedMachines.length === 0) {
    console.log("[config-reload] no changes detected");
  }

  return {
    reloaded: true,
    fleet_size: FLEET.length,
    changes: {
      added_models: addedModels,
      removed_models: removedModels,
      added_machines: addedMachines,
      removed_machines: removedMachines,
    },
  };
}

// ── Accessors ──────────────────────────────────────────────────────────────

export function getFleet(): ModelEntry[] {
  return FLEET;
}

export function getJuryModels(): ModelEntry[] {
  return JURY_MODELS;
}

export function getAllMachineNames(): string[] {
  return ALL_MACHINE_NAMES;
}

export function getOllamaMachines(): { name: string; host: string }[] {
  return OLLAMA_MACHINES;
}

export function getConfigSource(): "seed" | "legacy" | "env" {
  return CONFIG_SOURCE;
}

export function getRouterPort(): number {
  return ROUTER_PORT;
}

export function getMlxHost(): string {
  return MLX_HOST;
}

export function getMlxPythonPath(): string {
  return MLX_PYTHON_PATH;
}

export function getMlxStarterPath(): string {
  return MLX_STARTER_PATH;
}

export function getMlxModel(): string {
  return MLX_MODEL;
}

/**
 * Get the machine queue for a specific machine, or undefined if not found.
 * Unlike ensureQueue in the router (which lazily creates), this is a pure read
 * for testing purposes.
 */
export function getMachineQueue(machine: string): MachineQueue | undefined {
  return machineQueues[machine];
}

/**
 * Get or create a machine queue. Used by the router's withMachineQueue.
 */
export function ensureQueue(machine: string): MachineQueue {
  if (!machineQueues[machine]) {
    machineQueues[machine] = { promise: Promise.resolve(), depth: 0 };
  }
  return machineQueues[machine];
}
