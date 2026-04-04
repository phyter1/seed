/**
 * Single source of truth for the Seed fleet binary version.
 *
 * All three binaries (seed-agent, seed-cli, seed-control-plane) import
 * this constant. The version is compared against GitHub Releases tags
 * (prefixed with `v`) to decide whether a self-update is needed.
 *
 * Bump this in lockstep with the `v*.*.*` tag used to cut a release.
 */
export const SEED_VERSION = "0.3.1";

/** GitHub repo that publishes releases (owner/name). */
export const SEED_REPO = "phyter1/seed";
