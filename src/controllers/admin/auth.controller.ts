import type { Request, Response } from "express";
import { authenticateAppAdmin, authenticateCoffeeAdmin } from "../../services/admin/auth.service.js";
import { sendSuccess } from "../../utils/http.js";

/** POST /api/v1/admin/auth/app */
export async function loginAppAdminController(req: Request, res: Response): Promise<void> {
  const { pin } = req.validated!.body as { pin: string };
  const session = await authenticateAppAdmin(pin);
  sendSuccess(res, session);
}

/** POST /api/v1/admin/auth/coffee/:coffeeSlug */
export async function loginCoffeeAdminController(req: Request, res: Response): Promise<void> {
  const { coffeeSlug } = req.validated!.params as { coffeeSlug: string };
  const { pin } = req.validated!.body as { pin: string };
  const session = await authenticateCoffeeAdmin(coffeeSlug, pin);
  sendSuccess(res, session);
}
