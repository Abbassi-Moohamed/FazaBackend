import type { Response } from "express";

/** Success envelope used across the whole API. */
export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({ success: true, data } satisfies SuccessEnvelope<T>);
}
