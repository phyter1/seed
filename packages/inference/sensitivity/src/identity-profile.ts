/**
 * Identity profile — the default `SensitivityProfile` for Seed-as-identity-host.
 *
 * Design stance: most content in an identity repo is public-thinking material
 * (journal entries, research notes, blog drafts, convictions) and SHOULD be
 * eligible for cloud dispatch. A small set of specific things must never
 * leave: the operator's private strategy docs (under `ryan/`), credentials,
 * PII, and content the author explicitly marked as private.
 *
 * Default level is GENERAL. Any positive detection flips to SENSITIVE.
 * FRONTIER is never auto-assigned — callers opt in explicitly by passing
 * already-sanitized content and a different profile.
 */

import type {
  Classification,
  ClassifiableMessage,
  ClassifyContext,
  SensitivityProfile,
} from "./types";

// ─── Patterns ────────────────────────────────────────────────────────

/**
 * Path references to the operator's private strategy directory. We match
 * `ryan/` as a path segment — not as a bare word — so names like
 * "Ryan's blog" don't trip. Covers bare path, leading-slash, and the
 * canonical absolute location.
 */
const RYAN_PATH_PATTERNS: RegExp[] = [
  /(?:^|[\s/"'`(])ryan\//,
  /\/Users\/ryanlowe\/code\/existential\/ryan\//i,
];

/**
 * Credential-ish tokens. These are the shapes that actually leak — we don't
 * try to catch every possible secret, just the high-confidence patterns.
 */
const CREDENTIAL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "openai_key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: "anthropic_key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "gitlab_token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}/ },
  { name: "aws_key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}/ },
  {
    name: "private_key_block",
    pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  },
  {
    // Inline assignment: "password=...", "api_key: ...", quoted or bareword.
    name: "secret_assignment",
    pattern:
      /\b(?:password|passwd|api[_-]?key|secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{12,}/i,
  },
];

/**
 * PII shapes. Deliberately narrow — false positives here are costly.
 */
const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // SSN: 3-2-4 with hyphens. Bare 9-digit runs are too noisy.
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  // Phone: US-style with explicit separators or parens. Bare 10-digit runs
  // excluded (too many false positives with ids/timestamps).
  {
    name: "phone_number",
    pattern: /\(\d{3}\)\s*\d{3}[-.\s]\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b/,
  },
  {
    // HTML5 spec email regex (WHATWG / W3C), adapted for substring search
    // by removing the ^ / $ anchors. This is the same regex browsers use
    // to validate <input type="email">.
    // https://html.spec.whatwg.org/multipage/input.html#valid-e-mail-address
    name: "email_address",
    pattern:
      /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/,
  },
];

/**
 * Explicit markers the author wrote in the content itself. Case-sensitive
 * on the all-caps variants because that's how people write them when they
 * MEAN it; lowercase is informational and not a signal.
 */
const PRIVACY_MARKER_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "marker_private", pattern: /\bPRIVATE\b/ },
  { name: "marker_confidential", pattern: /\bCONFIDENTIAL\b/ },
  { name: "marker_secret", pattern: /\bSECRET\b/ },
  { name: "marker_do_not_share", pattern: /\bDO NOT SHARE\b/i },
  { name: "marker_nda", pattern: /\bNDA\b/ },
  { name: "marker_local_only", pattern: /\b(?:local[-\s]only|do not send to cloud)\b/i },
];

// ─── Detection ───────────────────────────────────────────────────────

function detectFlags(content: string): string[] {
  const flags: string[] = [];

  for (const p of CREDENTIAL_PATTERNS) {
    if (p.pattern.test(content)) flags.push(p.name);
  }
  for (const p of PII_PATTERNS) {
    if (p.pattern.test(content)) flags.push(p.name);
  }
  for (const p of PRIVACY_MARKER_PATTERNS) {
    if (p.pattern.test(content)) flags.push(p.name);
  }
  for (const r of RYAN_PATH_PATTERNS) {
    if (r.test(content)) {
      flags.push("ryan_path_ref");
      break;
    }
  }

  return flags;
}

// ─── Profile ─────────────────────────────────────────────────────────

export const IDENTITY_PROFILE_NAME = "identity" as const;

class IdentityProfile implements SensitivityProfile {
  readonly name = IDENTITY_PROFILE_NAME;

  classify(content: string, _context?: ClassifyContext): Classification {
    if (!content) {
      return {
        level: "GENERAL",
        local_only: false,
        reason: "empty content",
        flags: [],
      };
    }

    const flags = detectFlags(content);

    if (flags.length === 0) {
      return {
        level: "GENERAL",
        local_only: false,
        reason: "no sensitive patterns detected",
        flags: [],
      };
    }

    return {
      level: "SENSITIVE",
      local_only: true,
      reason: `identity profile detected: ${flags.join(", ")}`,
      flags,
    };
  }

  classifyMessages(
    messages: ClassifiableMessage[],
    context?: ClassifyContext
  ): Classification {
    // System messages are operator-authored instructions, not user content.
    // Including them trips false positives (instructions like "never share
    // CONFIDENTIAL data" would themselves be flagged CONFIDENTIAL).
    const combined = messages
      .filter((m) => m.role !== "system")
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .filter((s) => s.length > 0)
      .join("\n");

    return this.classify(combined, context);
  }
}

/** The compiled-in default profile for Seed. */
export const identityProfile: SensitivityProfile = new IdentityProfile();
