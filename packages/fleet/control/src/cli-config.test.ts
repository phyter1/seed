import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Each test gets an isolated temp dir to avoid cross-contamination.
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "seed-cli-config-"));
  // Clear all env vars that affect resolution
  delete process.env.SEED_CONTROL_URL;
  delete process.env.SEED_OPERATOR_TOKEN;
  delete process.env.SEED_CLI_CONFIG;
  delete process.env.SEED_AGENT_CONFIG;
});

afterEach(() => {
  delete process.env.SEED_CONTROL_URL;
  delete process.env.SEED_OPERATOR_TOKEN;
  delete process.env.SEED_CLI_CONFIG;
  delete process.env.SEED_AGENT_CONFIG;
  rmSync(tmp, { recursive: true, force: true });
});

// We re-import each time because the module reads env at call time (not import time),
// but we want a clean require cache just in case.
function loadModule() {
  return require("./cli-config") as typeof import("./cli-config");
}

describe("getControlUrl", () => {
  test("returns env var when SEED_CONTROL_URL is set", () => {
    process.env.SEED_CONTROL_URL = "http://from-env:9999";
    // Point configs to nonexistent paths so they don't interfere
    process.env.SEED_CLI_CONFIG = join(tmp, "no-cli.json");
    process.env.SEED_AGENT_CONFIG = join(tmp, "no-agent.json");

    const { getControlUrl } = loadModule();
    expect(getControlUrl()).toBe("http://from-env:9999");
  });

  test("returns cli.json value when env var is unset", () => {
    const cliPath = join(tmp, "cli.json");
    writeFileSync(cliPath, JSON.stringify({ control_url: "http://from-cli:8888" }));
    process.env.SEED_CLI_CONFIG = cliPath;
    process.env.SEED_AGENT_CONFIG = join(tmp, "no-agent.json");

    const { getControlUrl } = loadModule();
    expect(getControlUrl()).toBe("http://from-cli:8888");
  });

  test("falls back to agent.json control_url when cli.json is missing", () => {
    const agentPath = join(tmp, "agent.json");
    writeFileSync(
      agentPath,
      JSON.stringify({ control_url: "http://from-agent:4310", token: "secret" })
    );
    process.env.SEED_CLI_CONFIG = join(tmp, "no-cli.json");
    process.env.SEED_AGENT_CONFIG = agentPath;

    const { getControlUrl } = loadModule();
    expect(getControlUrl()).toBe("http://from-agent:4310");
  });

  test("converts agent.json ws:// URL to http://", () => {
    const agentPath = join(tmp, "agent.json");
    writeFileSync(
      agentPath,
      JSON.stringify({ control_url: "ws://control.local:4310" })
    );
    process.env.SEED_CLI_CONFIG = join(tmp, "no-cli.json");
    process.env.SEED_AGENT_CONFIG = agentPath;

    const { getControlUrl } = loadModule();
    expect(getControlUrl()).toBe("http://control.local:4310");
  });

  test("converts agent.json wss:// URL to https://", () => {
    const agentPath = join(tmp, "agent.json");
    writeFileSync(
      agentPath,
      JSON.stringify({ control_url: "wss://control.phytertek.com" })
    );
    process.env.SEED_CLI_CONFIG = join(tmp, "no-cli.json");
    process.env.SEED_AGENT_CONFIG = agentPath;

    const { getControlUrl } = loadModule();
    expect(getControlUrl()).toBe("https://control.phytertek.com");
  });

  test("returns DEFAULT_CONTROL_URL when both configs are missing", () => {
    process.env.SEED_CLI_CONFIG = join(tmp, "no-cli.json");
    process.env.SEED_AGENT_CONFIG = join(tmp, "no-agent.json");

    const { getControlUrl, DEFAULT_CONTROL_URL } = loadModule();
    expect(getControlUrl()).toBe(DEFAULT_CONTROL_URL);
    expect(getControlUrl()).toBe("http://localhost:4310");
  });

  test("env var takes priority over cli.json and agent.json", () => {
    process.env.SEED_CONTROL_URL = "http://env-wins:1111";
    const cliPath = join(tmp, "cli.json");
    writeFileSync(cliPath, JSON.stringify({ control_url: "http://cli:2222" }));
    process.env.SEED_CLI_CONFIG = cliPath;
    const agentPath = join(tmp, "agent.json");
    writeFileSync(agentPath, JSON.stringify({ control_url: "http://agent:3333" }));
    process.env.SEED_AGENT_CONFIG = agentPath;

    const { getControlUrl } = loadModule();
    expect(getControlUrl()).toBe("http://env-wins:1111");
  });

  test("cli.json takes priority over agent.json", () => {
    const cliPath = join(tmp, "cli.json");
    writeFileSync(cliPath, JSON.stringify({ control_url: "http://cli-wins:2222" }));
    process.env.SEED_CLI_CONFIG = cliPath;
    const agentPath = join(tmp, "agent.json");
    writeFileSync(agentPath, JSON.stringify({ control_url: "http://agent:3333" }));
    process.env.SEED_AGENT_CONFIG = agentPath;

    const { getControlUrl } = loadModule();
    expect(getControlUrl()).toBe("http://cli-wins:2222");
  });
});

describe("getOperatorToken", () => {
  test("returns env var when SEED_OPERATOR_TOKEN is set", () => {
    process.env.SEED_OPERATOR_TOKEN = "env-token";
    process.env.SEED_CLI_CONFIG = join(tmp, "no-cli.json");

    const { getOperatorToken } = loadModule();
    expect(getOperatorToken()).toBe("env-token");
  });

  test("returns cli.json token when env var is unset", () => {
    const cliPath = join(tmp, "cli.json");
    writeFileSync(cliPath, JSON.stringify({ operator_token: "cli-token" }));
    process.env.SEED_CLI_CONFIG = cliPath;

    const { getOperatorToken } = loadModule();
    expect(getOperatorToken()).toBe("cli-token");
  });

  test("does NOT read token from agent.json (token isolation)", () => {
    const agentPath = join(tmp, "agent.json");
    writeFileSync(
      agentPath,
      JSON.stringify({ control_url: "http://x:4310", token: "agent-secret" })
    );
    process.env.SEED_CLI_CONFIG = join(tmp, "no-cli.json");
    process.env.SEED_AGENT_CONFIG = agentPath;

    const { getOperatorToken } = loadModule();
    expect(getOperatorToken()).toBeUndefined();
  });

  test("returns undefined when no config exists", () => {
    process.env.SEED_CLI_CONFIG = join(tmp, "no-cli.json");

    const { getOperatorToken } = loadModule();
    expect(getOperatorToken()).toBeUndefined();
  });
});

describe("readAgentControlUrl", () => {
  test("returns undefined when agent.json has no control_url field", () => {
    const agentPath = join(tmp, "agent.json");
    writeFileSync(agentPath, JSON.stringify({ token: "only-token" }));
    process.env.SEED_AGENT_CONFIG = agentPath;

    const { readAgentControlUrl } = loadModule();
    expect(readAgentControlUrl()).toBeUndefined();
  });

  test("returns undefined when agent.json is invalid JSON", () => {
    const agentPath = join(tmp, "agent.json");
    writeFileSync(agentPath, "not json at all");
    process.env.SEED_AGENT_CONFIG = agentPath;

    const { readAgentControlUrl } = loadModule();
    expect(readAgentControlUrl()).toBeUndefined();
  });
});
