import type { CorsOptions } from "cors";
import { ApiError } from "../utils/ApiError.js";
import { env } from "./env.js";

/** Normalizes an origin string (strips trailing slash, lowercases scheme/host). */
function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/+$/, "");
  }
}

function buildAllowedOrigins(): string[] {
  const extras = env.CORS_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const wildcardAllowed = [env.FRONTEND_URL, ...extras].some((origin) => origin === "*");

  // Never allow wide-open CORS in production.
  if (wildcardAllowed && env.isProduction) {
    throw new Error(
      'CORS is configured to allow "*" while NODE_ENV=production. ' +
        "Set FRONTEND_URL / CORS_ORIGINS to explicit origins before deploying.",
    );
  }

  return [...new Set([env.FRONTEND_URL, ...extras].map(normalizeOrigin))];
}

const allowedOrigins = new Set(buildAllowedOrigins());

/**
 * Shared origin check used by both the REST CORS middleware and the
 * Socket.IO server, so both surfaces always agree on which browsers
 * may connect.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  // Non-browser clients (curl, server-to-server) send no Origin header.
  return !origin || allowedOrigins.has("*") || allowedOrigins.has(normalizeOrigin(origin));
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(new ApiError(403, "Origin not allowed by CORS"));
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Session-Token"],
  maxAge: 86_400,
};
