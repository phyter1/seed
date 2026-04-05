// Tier ordering and helpers for challenge-round escalation.

export type Tier = "local" | "midtier" | "frontier";

export const TIER_ORDER: readonly Tier[] = ["local", "midtier", "frontier"];

/** Returns index within TIER_ORDER. "local" = 0, "frontier" = 2. */
export function tierRank(tier: Tier): number {
  return TIER_ORDER.indexOf(tier);
}

/** Return the next tier above `from`, or null if `from` is already at `max`. */
export function nextTier(from: Tier, max: Tier): Tier | null {
  const fromIdx = tierRank(from);
  const maxIdx = tierRank(max);
  if (fromIdx >= maxIdx) return null;
  return TIER_ORDER[fromIdx + 1];
}

/** Return the lower of two tiers (min by rank). */
export function minTier(a: Tier, b: Tier): Tier {
  return tierRank(a) <= tierRank(b) ? a : b;
}
