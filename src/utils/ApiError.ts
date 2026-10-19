/**
 * Operational error with an HTTP status code.
 * Caught by the centralized error middleware and serialized
 * into the consistent `{ success: false, ... }` envelope.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
