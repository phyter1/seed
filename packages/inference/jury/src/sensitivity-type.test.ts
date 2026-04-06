import { describe, expect, test } from "bun:test";
import type { SensitivityLevel } from "@seed/sensitivity";
import type { Sensitivity } from "./challenge";
import type { JuryRequest } from "./types";

describe("SensitivityLevel import from @seed/sensitivity", () => {
  test("SensitivityLevel values are assignable to jury Sensitivity", () => {
    // Type-level check: SensitivityLevel from @seed/sensitivity should be
    // assignable to the jury's Sensitivity type after dedup.
    const level: SensitivityLevel = "SENSITIVE";
    const sensitivity: Sensitivity = level;
    expect(sensitivity).toBe("SENSITIVE");
  });

  test("all three levels are valid", () => {
    const levels: SensitivityLevel[] = ["SENSITIVE", "GENERAL", "FRONTIER"];
    for (const l of levels) {
      const s: Sensitivity = l;
      expect(s).toBe(l);
    }
  });

  test("JuryRequest.sensitivity accepts SensitivityLevel values", () => {
    // Verifies the JuryRequest type uses the same Sensitivity type
    const req: Pick<JuryRequest, "sensitivity"> = {
      sensitivity: "SENSITIVE" as SensitivityLevel,
    };
    expect(req.sensitivity).toBe("SENSITIVE");
  });
});
