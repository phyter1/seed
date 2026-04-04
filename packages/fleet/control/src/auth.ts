/**
 * Authentication utilities for the fleet control plane.
 *
 * Machine tokens are SHA-256 hashed before storage. Tokens are 256-bit random values
 * represented as hex strings. We use SHA-256 (not bcrypt) because these are high-entropy
 * random tokens, not user passwords — dictionary attacks don't apply.
 */

const encoder = new TextEncoder();

/** Generate a cryptographically random 256-bit token as a hex string */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Hash a token with SHA-256, returns hex string */
export async function hashToken(token: string): Promise<string> {
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Extract bearer token from Authorization header */
export function extractBearerToken(
  authHeader: string | null | undefined
): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}
