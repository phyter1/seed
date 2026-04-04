/**
 * Install hints engine.
 *
 * Examines an incoming install event plus recent history for the session
 * and returns a list of actionable hints the installer can use to decide
 * whether to retry, abort, wait, override, or continue.
 *
 * Keep this table small and focused — expand as we hit real failure modes
 * in the field. Known error patterns come through on `details.error_type`.
 */

import type { InstallEvent, InstallEventInput, InstallSession } from "./types";

export interface InstallHint {
  action: "retry" | "abort" | "wait" | "override" | "continue";
  reason: string;
  delay_ms?: number;
  key?: string;
  value?: string;
}

const MAX_CHECKSUM_RETRIES = 3;
const MAX_NETWORK_RETRIES = 3;

export function generateHints(
  event: InstallEventInput,
  _session: InstallSession,
  recentEvents: InstallEvent[]
): InstallHint[] {
  const hints: InstallHint[] = [];
  const details = event.details ?? {};
  const errorType =
    typeof details.error_type === "string" ? details.error_type : undefined;

  if (event.status === "ok") {
    hints.push({ action: "continue", reason: "step completed successfully" });
    return hints;
  }

  if (event.status === "started" || event.status === "retrying") {
    return hints;
  }

  // event.status === "failed"
  const priorFailures = recentEvents.filter(
    (e) => e.step === event.step && e.status === "failed"
  ).length;

  switch (errorType) {
    case "checksum_mismatch": {
      if (priorFailures < MAX_CHECKSUM_RETRIES) {
        hints.push({
          action: "retry",
          delay_ms: 5000,
          reason:
            "checksum mismatch — possibly a CDN caching issue, retrying",
        });
      } else {
        hints.push({
          action: "abort",
          reason:
            "checksum mismatch after 3 attempts — verify release integrity",
        });
      }
      break;
    }
    case "network_error": {
      if (priorFailures < MAX_NETWORK_RETRIES) {
        hints.push({
          action: "retry",
          delay_ms: 10000,
          reason: "network error, backing off 10s",
        });
      } else {
        hints.push({
          action: "abort",
          reason: "network error persisted across retries — check connectivity",
        });
      }
      break;
    }
    case "permission_denied": {
      hints.push({
        action: "abort",
        reason:
          "permission denied — check file permissions or sudo requirements",
      });
      break;
    }
    case "port_in_use": {
      hints.push({
        action: "abort",
        reason:
          "port already in use — stop conflicting service or use --port override",
      });
      break;
    }
    default: {
      // Unknown failure — surface it, let the installer decide.
      hints.push({
        action: "continue",
        reason: `unhandled failure (${errorType ?? "unknown"}) — installer decides`,
      });
    }
  }

  return hints;
}
