import "dotenv/config";
import { z } from "zod";

const DEV_ADMIN_SECRET = "faza-dev-admin-secret-do-not-use-in-prod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  /** Maximum in-memory image upload size in megabytes. */
  IMAGE_UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(100).default(25),

  /**
   * MongoDB connection string. This is the single source of truth for the
   * database provider/location — change it here and the whole app follows.
   */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").default("mongodb://127.0.0.1:27017/faza"),

  /** Primary CORS origin (the Next.js frontend). */
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),

  /** Optional extra CORS origins, comma-separated. */
  CORS_ORIGINS: z.string().optional().default(""),

  /**
   * Static PIN for the Faza application administrator.
   * Lightweight MVP gate — NOT a substitute for real authentication.
   */
  APP_ADMIN_PIN: z
    .string()
    .regex(/^\d{4}$/, "APP_ADMIN_PIN must be exactly 4 digits.")
    .default("3219"),

  /**
   * Secret used to sign the short-lived admin bearer tokens (HS256).
   * Must be a long random value in every environment except local dev.
   */
  ADMIN_SECRET: z.string().min(16, "ADMIN_SECRET must be at least 16 characters.").default(DEV_ADMIN_SECRET),

  /** Lifetime of admin tokens, in jsonwebtoken notation (e.g. "12h"). */
  ADMIN_TOKEN_TTL: z.string().min(1).default("12h"),

  /** Cloudflare R2 configuration (server-side only). */
  CLOUDFLARE_ACCOUNT_ID: z.string().default(""),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().default(""),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().default(""),
  CLOUDFLARE_R2_BUCKET_NAME: z
    .string()
    .regex(
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/,
      "CLOUDFLARE_R2_BUCKET_NAME must use lowercase letters, numbers, dots, or hyphens.",
    )
    .default(""),
  CLOUDFLARE_R2_ENDPOINT: z.union([z.string().url(), z.literal("")]).default(""),
  CLOUDFLARE_R2_PUBLIC_URL: z.union([z.string().url(), z.literal("")]).default(""),

  LOG_LEVEL: z.string().default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Log plainly to stderr BEFORE the logger exists (logger depends on env).
  // No stack traces, no secrets — just the offending fields.
  console.error(
    "Invalid environment configuration:",
    parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join(", "),
  );
  process.exit(1);
}

const data = parsed.data;

// The development default signer secret must never ship to production.
if (data.NODE_ENV === "production" && data.ADMIN_SECRET === DEV_ADMIN_SECRET) {
  console.error(
    "Invalid environment configuration: ADMIN_SECRET must be overridden in production (the default dev value is not allowed).",
  );
  process.exit(1);
}

export const env = {
  ...data,
  nodeEnv: data.NODE_ENV,
  apiPrefix: "/api",
  isProduction: data.NODE_ENV === "production",
  isDevelopment: data.NODE_ENV === "development",
  isTest: data.NODE_ENV === "test",
  cloudflareR2Configured:
    data.CLOUDFLARE_ACCOUNT_ID.length > 0 &&
    data.CLOUDFLARE_R2_ACCESS_KEY_ID.length > 0 &&
    data.CLOUDFLARE_R2_SECRET_ACCESS_KEY.length > 0 &&
    data.CLOUDFLARE_R2_BUCKET_NAME.length > 0 &&
    data.CLOUDFLARE_R2_ENDPOINT.length > 0 &&
    data.CLOUDFLARE_R2_PUBLIC_URL.length > 0,
} as const;
