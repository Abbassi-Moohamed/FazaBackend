import pino from "pino";
import { env } from "../config/env.js";

/**
 * Application logger (pino).
 * - development: pretty-printed for the terminal
 * - test: silent (keeps test output clean)
 * - production: structured JSON for log aggregation
 *
 * Never log raw environment values (DATABASE_URL contains credentials).
 */
export const logger = pino({
  level: env.isTest ? "silent" : env.LOG_LEVEL,
  ...(env.isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
      }
    : {}),
});
