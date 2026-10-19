import type { Request, Response } from "express";
import { changeMyPin, getMyCoffee, updateMyCoffee } from "../../../services/admin/coffee-admin.service.js";
import { sendSuccess } from "../../../utils/http.js";

function adminCoffeeId(req: Request): string {
  return req.admin!.coffeeId!;
}

/** GET /api/v1/admin/my-coffee */
export async function getMyCoffeeController(req: Request, res: Response): Promise<void> {
  const coffee = await getMyCoffee(adminCoffeeId(req));
  sendSuccess(res, coffee);
}

/** PATCH /api/v1/admin/my-coffee */
export async function updateMyCoffeeController(req: Request, res: Response): Promise<void> {
  const body = req.validated!.body as { name?: string; logo?: string; cover?: string; slug?: string };
  const coffee = await updateMyCoffee(adminCoffeeId(req), body);
  sendSuccess(res, coffee);
}

/** PATCH /api/v1/admin/my-coffee/pin */
export async function changeMyPinController(req: Request, res: Response): Promise<void> {
  const { currentPin, newPin } = req.validated!.body as { currentPin: string; newPin: string };
  const result = await changeMyPin(adminCoffeeId(req), currentPin, newPin);
  sendSuccess(res, result);
}
