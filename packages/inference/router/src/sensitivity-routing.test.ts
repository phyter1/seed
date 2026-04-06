import { describe, expect, test } from "bun:test";
import {
  identityProfile,
  type ClassifiableMessage,
  type Classification,
} from "@seed/sensitivity";

describe("sensitivity classification via identityProfile", () => {
  test("messages with credentials are classified SENSITIVE with local_only", () => {
    const messages: ClassifiableMessage[] = [
      { role: "user", content: "my API key is sk-abc123def456ghi789jkl012" },
    ];
    const result = identityProfile.classifyMessages(messages);
    expect(result.level).toBe("SENSITIVE");
    expect(result.local_only).toBe(true);
  });

  test("normal messages are classified GENERAL", () => {
    const messages: ClassifiableMessage[] = [
      { role: "user", content: "What is the weather like today?" },
    ];
    const result = identityProfile.classifyMessages(messages);
    expect(result.level).toBe("GENERAL");
    expect(result.local_only).toBe(false);
  });

  test("non-string content is coerced to empty string for classification", () => {
    const messages: ClassifiableMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];
    const result = identityProfile.classifyMessages(messages);
    expect(result.level).toBe("GENERAL");
  });
});

interface FleetEntry {
  machine: string;
  host: string;
  provider: "openai_compatible" | "ollama";
  model: string;
  tags: string[];
  priority: number;
  locality: "local" | "cloud";
}

/**
 * Extracted rerouting logic matching the router's chat handler. This tests
 * the algorithm in isolation without needing to start the HTTP server.
 */
function applyReroute(
  fleet: FleetEntry[],
  entry: FleetEntry,
  reason: string,
  sensitivity: Classification,
): { entry: FleetEntry; reason: string } {
  if (sensitivity.local_only && entry.locality === "cloud") {
    const fallback = fleet.find((m) => m.locality !== "cloud");
    if (fallback) {
      return {
        entry: fallback,
        reason: `sensitivity:${sensitivity.level} (rerouted from cloud)`,
      };
    }
  }
  return { entry, reason };
}

describe("sensitivity-based rerouting logic", () => {
  const cloudEntry: FleetEntry = {
    machine: "groq-cloud",
    host: "api.groq.com",
    provider: "openai_compatible",
    model: "llama-3.3-70b",
    tags: ["general"],
    priority: 1,
    locality: "cloud",
  };
  const localEntry: FleetEntry = {
    machine: "mlx_ren3",
    host: "ren3.local:8080",
    provider: "openai_compatible",
    model: "mlx-community/Qwen3.5-9B-MLX-4bit",
    tags: ["general"],
    priority: 2,
    locality: "local",
  };

  test("sensitive classification reroutes from cloud to local entry", () => {
    const fleet = [cloudEntry, localEntry];
    const sensitivity: Classification = {
      level: "SENSITIVE",
      local_only: true,
      reason: "identity profile detected: openai_key",
      flags: ["openai_key"],
    };

    const result = applyReroute(fleet, cloudEntry, "default (general, fast)", sensitivity);
    expect(result.entry).toBe(localEntry);
    expect(result.reason).toBe("sensitivity:SENSITIVE (rerouted from cloud)");
  });

  test("general classification does not reroute cloud entry", () => {
    const fleet = [cloudEntry, localEntry];
    const sensitivity: Classification = {
      level: "GENERAL",
      local_only: false,
      reason: "no sensitive patterns detected",
      flags: [],
    };

    const result = applyReroute(fleet, cloudEntry, "default (general, fast)", sensitivity);
    expect(result.entry).toBe(cloudEntry);
  });

  test("sensitive classification on local entry is a no-op", () => {
    const fleet = [localEntry];
    const sensitivity: Classification = {
      level: "SENSITIVE",
      local_only: true,
      reason: "identity profile detected: ssn",
      flags: ["ssn"],
    };

    const result = applyReroute(fleet, localEntry, "default (general, fast)", sensitivity);
    expect(result.entry).toBe(localEntry);
  });
});
