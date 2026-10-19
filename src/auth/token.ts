import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AdminRole } from "../types/index.js";

/** Human-readable token lifetime (also embedded in the auth response). */
export const ADMIN_TOKEN_LIFETIME = env.ADMIN_TOKEN_TTL;

const ISSUER = "faza-backend";

interface AdminTokenPayload {
  role: AdminRole;
  /** Present only for COFFEE_ADMIN tokens: the single owned coffee. */
  coffeeId?: string;
}

/** Signs a short-lived admin bearer token (HS256). */
export async function issueAdminToken(payload: AdminTokenPayload): Promise<string> {
  return jwt.sign(payload, env.ADMIN_SECRET, {
    algorithm: "HS256",
    issuer: ISSUER,
    expiresIn: ADMIN_TOKEN_LIFETIME as jwt.SignOptions["expiresIn"],
  });
}

/**
 * Verifies an admin bearer token. Returns the token payload; throws when the
 * token is missing, malformed, expired or signed with a different secret.
 */
export async function verifyAdminToken(token: string): Promise<AdminTokenPayload> {
  const decoded = jwt.verify(token, env.ADMIN_SECRET, {
    algorithms: ["HS256"],
    issuer: ISSUER,
  });

  if (typeof decoded === "string") throw new Error("Invalid token payload");

  const role = decoded.role;
  if (role !== "APP_ADMIN" && role !== "COFFEE_ADMIN") throw new Error("Invalid token role");

  return {
    role,
    coffeeId: typeof decoded.coffeeId === "string" ? decoded.coffeeId : undefined,
  };
}
