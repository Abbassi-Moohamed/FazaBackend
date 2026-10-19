import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ApiError } from "../utils/ApiError.js";

export interface FieldIssue {
  field: string;
  message: string;
}

export interface ValidateSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

/**
 * Validates `params`, `query` and/or `body` against Zod schemas before a
 * request reaches a controller. Malformed requests are rejected with a
 * consistent 400 envelope and never reach the database.
 *
 * Parsed (and transformed) data is attached to `req.validated`.
 */
export function validate(schemas: ValidateSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const issues: FieldIssue[] = [];
    const validated: NonNullable<Request["validated"]> = {};
    const targets: Record<keyof ValidateSchemas, unknown> = {
      params: req.params,
      query: req.query,
      body: req.body,
    };

    for (const [location, schema] of Object.entries(schemas) as [keyof ValidateSchemas, ZodType][]) {
      if (!schema) continue;

      const result = schema.safeParse(targets[location]);
      if (result.success) {
        validated[location] = result.data as Record<string, unknown>;
      } else {
        const error = result.error as { issues: { path: (string | number)[]; message: string }[] };
        for (const issue of error.issues) {
          issues.push({ field: [location, ...issue.path].join("."), message: issue.message });
        }
      }
    }

    if (issues.length > 0) {
      next(new ApiError(400, "Validation failed", issues));
      return;
    }

    req.validated = validated;
    next();
  };
}
