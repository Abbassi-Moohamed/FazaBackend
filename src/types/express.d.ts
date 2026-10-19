/**
 * Augments Express.Request so the validation middleware can attach
 * fully-parsed, schema-checked request data consumed by controllers, and the
 * auth middleware can attach the verified admin authorization context.
 */
import type { AdminContext } from "./index.js";

declare global {
  namespace Express {
    interface Request {
      validated?: {
        params?: Record<string, unknown>;
        query?: Record<string, unknown>;
        body?: unknown;
      };
      /** Present only on requests that passed admin authentication. */
      admin?: AdminContext;
    }
  }
}

export {};
