/**
 * Single source of truth for the Seed fleet binary version.
 *
 * All three binaries (seed-agent, seed-cli, seed-control-plane) import
 * this constant. The version is compared against GitHub Releases tags
 * (prefixed with `v`) to decide whether a self-update is needed.
 *
 * The default "0.0.0-dev" value applies to local builds. The release
 * workflow stamps this file with the actual tag version (stripped of
 * the `v` prefix) before running `bun build --compile`, so published
 * binaries always report the version of the tag that produced them.
 * See `.github/workflows/release.yml` — the "Stamp version" step.
 */
export const SEED_VERSION = "0.6.0";

/** GitHub repo that publishes releases (owner/name). */
export const SEED_REPO = "phyter1/seed";
