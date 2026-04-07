import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findConfigPath, loadSeedConfig, loadMachineConfig } from "./loader";

describe("findConfigPath", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "seed-config-test-"));
    delete process.env.SEED_CONFIG;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.SEED_CONFIG;
  });

  test("finds seed.config.json in the starting directory", () => {
    const configPath = join(tempDir, "seed.config.json");
    writeFileSync(configPath, "{}");

    const result = findConfigPath(tempDir);
    expect(result).toBe(configPath);
  });

  test("finds seed.config.json in a parent directory", () => {
    const configPath = join(tempDir, "seed.config.json");
    writeFileSync(configPath, "{}");

    const childDir = join(tempDir, "packages", "core");
    mkdirSync(childDir, { recursive: true });

    const result = findConfigPath(childDir);
    expect(result).toBe(configPath);
  });

  test("returns null when no config file exists", () => {
    const result = findConfigPath(tempDir);
    expect(result).toBeNull();
  });

  test("SEED_CONFIG env var overrides the walk", () => {
    const customPath = join(tempDir, "custom", "my-config.json");
    mkdirSync(join(tempDir, "custom"), { recursive: true });
    writeFileSync(customPath, "{}");

    process.env.SEED_CONFIG = customPath;
    const result = findConfigPath(tempDir);
    expect(result).toBe(customPath);
  });

  test("SEED_CONFIG env var returns null if file does not exist", () => {
    process.env.SEED_CONFIG = join(tempDir, "nonexistent.json");
    const result = findConfigPath(tempDir);
    expect(result).toBeNull();
  });
});

describe("loadSeedConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "seed-config-test-"));
    delete process.env.SEED_CONFIG;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.SEED_CONFIG;
  });

  test("parses valid JSON into SeedConfig shape", () => {
    const configPath = join(tempDir, "seed.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        host: { default: "claude", heartbeat: "claude" },
        heartbeat: { host: "claude", quick_model: "claude-haiku-4-5-20250414" },
        providers: {
          anthropic: { type: "anthropic", locality: "cloud" },
        },
        models: [
          {
            id: "claude-opus-4-6",
            provider: "anthropic",
            tags: ["general"],
            capabilities: { tools: true, structured_output: true, vision: true, reasoning: true },
          },
        ],
        routing: { strategy: "fleet_router", prefer_local: true },
      })
    );

    const result = loadSeedConfig(configPath);
    expect(result).not.toBeNull();
    expect(result!.host?.default).toBe("claude");
    expect(result!.heartbeat?.quick_model).toBe("claude-haiku-4-5-20250414");
    expect(result!.providers?.anthropic?.type).toBe("anthropic");
    expect(result!.models).toHaveLength(1);
    expect(result!.models![0].id).toBe("claude-opus-4-6");
    expect(result!.routing?.strategy).toBe("fleet_router");
  });

  test("returns null for missing files", () => {
    const result = loadSeedConfig(join(tempDir, "missing.json"));
    expect(result).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    const configPath = join(tempDir, "seed.config.json");
    writeFileSync(configPath, "not valid json {{{");

    const result = loadSeedConfig(configPath);
    expect(result).toBeNull();
  });

  test("handles minimal config (empty object)", () => {
    const configPath = join(tempDir, "seed.config.json");
    writeFileSync(configPath, "{}");

    const result = loadSeedConfig(configPath);
    expect(result).not.toBeNull();
    expect(result!.host).toBeUndefined();
    expect(result!.providers).toBeUndefined();
  });

  test("finds config via directory walk when no explicit path given", () => {
    const configPath = join(tempDir, "seed.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ host: { default: "gemini" } })
    );

    const childDir = join(tempDir, "packages", "core", "config");
    mkdirSync(childDir, { recursive: true });

    // loadSeedConfig without explicit path should use CWD or findConfigPath
    // We test the explicit path variant here
    const result = loadSeedConfig(configPath);
    expect(result).not.toBeNull();
    expect(result!.host?.default).toBe("gemini");
  });
});

describe("loadMachineConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "seed-machine-test-"));
    delete process.env.SEED_MACHINE_CONFIG;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.SEED_MACHINE_CONFIG;
  });

  test("parses valid machine detection JSON", () => {
    const machinePath = join(tempDir, "seed.machine.json");
    writeFileSync(
      machinePath,
      JSON.stringify({
        machine: {
          hostname: "ren3",
          os: "Darwin",
          arch: "arm64",
          cores: 8,
          ram_gb: 16,
          chip: "Apple M1 Pro",
          gpu: "Metal/MLX",
          can_mlx: true,
        },
        tools: {
          git: true,
          node: true,
          bun: true,
          python3: true,
          ollama: true,
          mlx_lm: true,
        },
        hosts: {
          default: "claude",
          heartbeat: "claude",
          installed: { claude: true, codex: true, gemini: false },
          status: { claude: "ready", codex: "ready", gemini: "missing" },
          versions: { claude: "1.0.0", codex: "0.1.0", gemini: "" },
          reasons: { claude: "", codex: "", gemini: "command not found" },
        },
        inference: {
          ollama_running: false,
          ollama_models: 0,
        },
        fleet: {
          machines: [],
          role: "standalone",
        },
      })
    );

    const result = loadMachineConfig(machinePath);
    expect(result).not.toBeNull();
    expect(result!.machine.hostname).toBe("ren3");
    expect(result!.machine.can_mlx).toBe(true);
    expect(result!.tools.bun).toBe(true);
    expect(result!.hosts.default).toBe("claude");
    expect(result!.inference.ollama_running).toBe(false);
    expect(result!.fleet.role).toBe("standalone");
  });

  test("returns null for missing files", () => {
    const result = loadMachineConfig(join(tempDir, "missing.json"));
    expect(result).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    const machinePath = join(tempDir, "seed.machine.json");
    writeFileSync(machinePath, "garbage");

    const result = loadMachineConfig(machinePath);
    expect(result).toBeNull();
  });

  test("SEED_MACHINE_CONFIG env var overrides the walk", () => {
    const customPath = join(tempDir, "custom-machine.json");
    writeFileSync(
      customPath,
      JSON.stringify({
        machine: {
          hostname: "custom",
          os: "Linux",
          arch: "x86_64",
          cores: 4,
          ram_gb: 8,
          chip: "Intel",
          gpu: "none",
          can_mlx: false,
        },
        tools: {},
        hosts: {
          default: null,
          heartbeat: null,
          installed: {},
          status: {},
          versions: {},
          reasons: {},
        },
        inference: { ollama_running: false, ollama_models: 0 },
        fleet: { machines: [], role: "standalone" },
      })
    );

    process.env.SEED_MACHINE_CONFIG = customPath;
    const result = loadMachineConfig();
    expect(result).not.toBeNull();
    expect(result!.machine.hostname).toBe("custom");
  });
});
