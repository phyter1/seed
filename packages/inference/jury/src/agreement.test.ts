import { describe, expect, test } from "bun:test";
import { calculateAgreement } from "./agreement";

describe("calculateAgreement", () => {
  test("returns 1 for zero responses", () => {
    expect(calculateAgreement([])).toBe(1);
  });

  test("returns 1 for single response", () => {
    expect(calculateAgreement(["the quick brown fox"])).toBe(1);
  });

  test("returns 1 for identical responses", () => {
    expect(calculateAgreement(["hello world again", "hello world again"])).toBe(1);
  });

  test("returns 0 for fully disjoint responses", () => {
    const a = "alpha beta gamma delta";
    const b = "epsilon zeta theta iota";
    expect(calculateAgreement([a, b])).toBe(0);
  });

  test("returns partial overlap for half-shared vocabulary", () => {
    const a = "alpha beta gamma delta";
    const b = "alpha beta zeta theta";
    // 2 shared / 6 union = 0.33
    expect(calculateAgreement([a, b])).toBeGreaterThan(0.2);
    expect(calculateAgreement([a, b])).toBeLessThan(0.5);
  });

  test("ignores words of length <= 3", () => {
    // Short words are filtered, so "to be or not" drops everything.
    const a = "to be or not";
    const b = "this that them then";
    expect(calculateAgreement([a, b])).toBe(0);
  });

  test("is case-insensitive", () => {
    const upper = "HELLO WORLD AGAIN";
    const lower = "hello world again";
    expect(calculateAgreement([upper, lower])).toBe(1);
  });

  test("averages across pairs for 3+ responses", () => {
    const a = "alpha beta gamma";
    const b = "alpha beta delta";
    const c = "alpha beta epsilon";
    // Every pair shares {alpha,beta} out of a 4-word union → 0.5
    expect(calculateAgreement([a, b, c])).toBe(0.5);
  });
});
