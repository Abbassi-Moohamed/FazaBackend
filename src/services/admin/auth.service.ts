import { ADMIN_TOKEN_LIFETIME, issueAdminToken } from "../../auth/token.js";
import { safeStringEqual, verifyPin } from "../../auth/pin.js";
import { env } from "../../config/env.js";
import { findCoffeeWithPinHashBySlug } from "../../repositories/admin/coffee.repository.js";
import type { AdminAuthDto } from "../../types/index.js";
import { ApiError } from "../../utils/ApiError.js";

/**
 * Verifies a PIN and issues a short-lived admin bearer token.
 * No session is stored server-side — the token itself carries the role and
 * (for coffee admins) the single owned coffee id.
 */

export async function authenticateAppAdmin(pin: string): Promise<AdminAuthDto> {
  if (!safeStringEqual(pin, env.APP_ADMIN_PIN)) {
    throw new ApiError(401, "Invalid PIN");
  }

  const token = await issueAdminToken({ role: "APP_ADMIN" });
  return { token, role: "APP_ADMIN", expiresIn: ADMIN_TOKEN_LIFETIME };
}

export async function authenticateCoffeeAdmin(slug: string, pin: string): Promise<AdminAuthDto> {
  const coffee = await findCoffeeWithPinHashBySlug(slug);
  if (!coffee) {
    throw new ApiError(404, "Coffee not found");
  }

  const matches =
    coffee.adminPinHash !== undefined && coffee.adminPinHash !== null && (await verifyPin(pin, coffee.adminPinHash));
  if (!matches) {
    throw new ApiError(401, "Invalid PIN");
  }

  const coffeeId = coffee._id.toString();
  const token = await issueAdminToken({ role: "COFFEE_ADMIN", coffeeId });
  return { token, role: "COFFEE_ADMIN", coffeeId, expiresIn: ADMIN_TOKEN_LIFETIME };
}
