import type { NextFunction, Request, Response } from "express";
import { isApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Centralized error handler.
 * Serializes every error into the consistent `{ success: false, message[, details] }`
 * envelope. Prevents leaking stack traces, credentials or internals on the
 * wire — full details are only ever written to the server logs.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let statusCode = 500;
  let message = "Internal server error";
  let details: unknown;

  if (isApiError(err)) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err && typeof err === "object" && err.constructor?.name === "ZodError") {
    const zodError = err as { issues: { path: (string | number)[]; message: string }[] };
    statusCode = 400;
    message = "Validation failed";
    details = zodError.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
  } else {
    const record = asRecord(err);

    if (record?.name === "CastError") {
      // Mongoose cast failure (e.g. a malformed ObjectId that slipped past validation).
      statusCode = 400;
      message = "Invalid identifier";
    } else if (record?.name === "ValidationError") {
      // Mongoose document validation (future-admin writes).
      statusCode = 400;
      message = "Validation failed";
      details = Object.values((record as { errors?: Record<string, unknown> }).errors ?? {}).map((entry) => {
        const e = asRecord(entry);
        return { field: String(e?.path ?? "unknown"), message: String(e?.message ?? "Invalid value") };
      });
    } else if (record?.code === 11000) {
      // MongoDB duplicate key.
      statusCode = 409;
      message = "Resource already exists";
    } else if (record?.type === "entity.parse.failed") {
      statusCode = 400;
      message = "Malformed JSON body";
    } else if (record?.type === "entity.too.large") {
      statusCode = 413;
      message = "Request body too large";
    } else if (record?.name === "MulterError") {
      // multer upload errors (file size/field limits) become clean 4xx codes.
      statusCode = record.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      message = record.code === "LIMIT_FILE_SIZE" ? "Image file too large" : "Invalid image upload";
    } else if (typeof record?.status === "number") {
      // body-parser and friends attach a status.
      statusCode = record.status as number;
      message = typeof record.message === "string" ? (record.message as string) : message;
    }
  }

  if (statusCode >= 500) {
    logger.error({ err, method: req.method, url: req.originalUrl }, "Unhandled error");
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(details !== undefined ? { details } : {}),
  } satisfies { success: false; message: string; details?: unknown });
}
