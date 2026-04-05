import { describe, expect, test } from "bun:test";
import { minTier, nextTier, TIER_ORDER, tierRank } from "./tiers";

describe("tiers", () => {
  test("TIER_ORDER is local < midtier < frontier", () => {
    expect(TIER_ORDER).toEqual(["local", "midtier", "frontier"]);
  });

  test("tierRank returns index", () => {
    expect(tierRank("local")).toBe(0);
    expect(tierRank("midtier")).toBe(1);
    expect(tierRank("frontier")).toBe(2);
  });

  test("nextTier returns next when below max", () => {
    expect(nextTier("local", "frontier")).toBe("midtier");
    expect(nextTier("midtier", "frontier")).toBe("frontier");
  });

  test("nextTier returns null when at max", () => {
    expect(nextTier("frontier", "frontier")).toBeNull();
    expect(nextTier("midtier", "midtier")).toBeNull();
    expect(nextTier("local", "local")).toBeNull();
  });

  test("nextTier returns null when already above max", () => {
    expect(nextTier("frontier", "local")).toBeNull();
    expect(nextTier("midtier", "local")).toBeNull();
  });

  test("minTier returns lower of two", () => {
    expect(minTier("local", "frontier")).toBe("local");
    expect(minTier("frontier", "local")).toBe("local");
    expect(minTier("midtier", "frontier")).toBe("midtier");
    expect(minTier("midtier", "midtier")).toBe("midtier");
  });
});
