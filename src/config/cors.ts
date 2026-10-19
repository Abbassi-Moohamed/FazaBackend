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

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Non-browser clients (curl, server-to-server) send no Origin header.
    if (!origin || allowedOrigins.has("*") || allowedOrigins.has(normalizeOrigin(origin))) {
      callback(null, true);
      return;
    }
    callback(new ApiError(403, "Origin not allowed by CORS"));
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86_400,
};
