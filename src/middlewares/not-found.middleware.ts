import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";

/** Catches routes that don't exist and turns them into a consistent 404. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}
