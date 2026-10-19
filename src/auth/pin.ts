import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

/** PIN hashes use the format: `scrypt$<base64 salt>$<base64 derived key>`. */
const FORMAT = "scrypt";

export const PIN_DIGITS = /^\d{4}$/;

/**
 * One-way hashes a 4-digit PIN with a per-value random salt (Node's scrypt,
 * constant-time comparison on verification). Never reversible, never plaintext.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = (await scryptAsync(pin, salt, KEY_LENGTH)) as Buffer;
  return `${FORMAT}$${salt.toString("base64")}$${derivedKey.toString("base64")}`;
}

/**
 * Verifies a PIN against a stored `scrypt$...` hash using a time-safe
 * comparison. Returns false for anything that is not a valid hash string,
 * so a tampered/absent stored value just fails closed.
 */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const [scheme, saltPart, keyPart] = storedHash.split("$");
  if (scheme !== FORMAT || !saltPart || !keyPart) return false;

  let salt: Buffer;
  let expectedKey: Buffer;
  try {
    salt = Buffer.from(saltPart, "base64");
    expectedKey = Buffer.from(keyPart, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expectedKey.length === 0) return false;

  const derivedKey = (await scryptAsync(pin, salt, expectedKey.length)) as Buffer;
  return timingSafeEqual(derivedKey, expectedKey);
}

/**
 * Constant-time comparison for two plain ASCII strings (used for the static
 * application PIN, which is not stored hashed but still must not leak timing).
 */
export function safeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
