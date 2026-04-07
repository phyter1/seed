/**
 * Shared config file locator and loader.
 *
 * Finds and parses seed.config.json (user intent) and seed.machine.json
 * (hardware detection output). Does NOT do env var merging — that stays
 * in each consumer since they have different env var sets.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import type { SeedConfig } from "./types";
import type { SeedMachineDetection } from "./machine-types";

const SEED_CONFIG_FILENAME = "seed.config.json";
const MACHINE_CONFIG_FILENAME = "seed.machine.json";

/**
 * Walk up from `startDir` looking for a file with the given name.
 * Stops at the filesystem root.
 */
function walkUp(startDir: string, filename: string): string | null {
  let current = resolve(startDir);
  const root = resolve("/");

  while (true) {
    const candidate = join(current, filename);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current || current === root) {
      return null;
    }
    current = parent;
  }
}

/**
 * Find seed.config.json by walking up from a starting directory.
 *
 * Resolution order:
 *   1. SEED_CONFIG env var (if set and file exists)
 *   2. Walk up from startDir (defaults to cwd)
 */
export function findConfigPath(startDir?: string): string | null {
  const fromEnv = process.env.SEED_CONFIG;
  if (fromEnv) {
    return existsSync(fromEnv) ? fromEnv : null;
  }
  return walkUp(startDir ?? process.cwd(), SEED_CONFIG_FILENAME);
}

/**
 * Find seed.machine.json by walking up from a starting directory.
 *
 * Resolution order:
 *   1. SEED_MACHINE_CONFIG env var (if set and file exists)
 *   2. Walk up from startDir (defaults to cwd)
 */
export function findMachineConfigPath(startDir?: string): string | null {
  const fromEnv = process.env.SEED_MACHINE_CONFIG;
  if (fromEnv) {
    return existsSync(fromEnv) ? fromEnv : null;
  }
  return walkUp(startDir ?? process.cwd(), MACHINE_CONFIG_FILENAME);
}

/**
 * Load and parse seed.config.json.
 *
 * @param path - Explicit path to the config file. If omitted, uses findConfigPath().
 * @returns Parsed config or null if file is missing or unparseable.
 */
export function loadSeedConfig(path?: string): SeedConfig | null {
  const resolved = path ?? findConfigPath();
  if (!resolved || !existsSync(resolved)) {
    return null;
  }

  try {
    const raw = readFileSync(resolved, "utf-8");
    return JSON.parse(raw) as SeedConfig;
  } catch {
    return null;
  }
}

/**
 * Load and parse seed.machine.json.
 *
 * @param path - Explicit path to the machine config file. If omitted, uses findMachineConfigPath().
 * @returns Parsed machine detection or null if file is missing or unparseable.
 */
export function loadMachineConfig(path?: string): SeedMachineDetection | null {
  const resolved = path ?? findMachineConfigPath();
  if (!resolved || !existsSync(resolved)) {
    return null;
  }

  try {
    const raw = readFileSync(resolved, "utf-8");
    return JSON.parse(raw) as SeedMachineDetection;
  } catch {
    return null;
  }
}
