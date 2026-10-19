import type { NextFunction, Request, Response } from "express";
import { verifyAdminToken } from "../auth/token.js";
import type { AdminContext } from "../types/index.js";
import { ApiError, isApiError } from "../utils/ApiError.js";

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches the
 * decoded admin context to `req.admin`. Rejects with 401 when the header is
 * missing, malformed, expired or invalid.
 */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new ApiError(401, "Unauthorized");
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) throw new ApiError(401, "Unauthorized");

    const payload = await verifyAdminToken(token);
    const context: AdminContext = { role: payload.role, coffeeId: payload.coffeeId };
    req.admin = context;
    next();
  } catch (error) {
    // jsonwebtoken errors (expired/tampered/unknown issuer) become a clean 401,
    // never a 500.
    next(isApiError(error) ? error : new ApiError(401, "Unauthorized"));
  }
}

/** The request must carry an ADMIN context with the application-admin role. */
export function requireAppAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.admin?.role !== "APP_ADMIN") {
    next(new ApiError(403, "Forbidden"));
    return;
  }
  next();
}

/** The request must carry a COFFEE_ADMIN context for a specific coffee. */
export function requireCoffeeAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.admin?.role !== "COFFEE_ADMIN" || !req.admin.coffeeId) {
    next(new ApiError(403, "Forbidden"));
    return;
  }
  next();
}
