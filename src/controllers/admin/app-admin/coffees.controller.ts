import type { Request, Response } from "express";
import {
  createCoffee,
  deleteCoffee,
  getCoffee,
  listCoffees,
  resetCoffeePin,
  updateCoffee,
} from "../../../services/admin/app-coffee.service.js";
import { sendSuccess } from "../../../utils/http.js";

/** GET /api/v1/admin/coffees */
export async function listAdminCoffeesController(_req: Request, res: Response): Promise<void> {
  const coffees = await listCoffees();
  sendSuccess(res, coffees);
}

/** POST /api/v1/admin/coffees */
export async function createAdminCoffeeController(req: Request, res: Response): Promise<void> {
  const { name, slug, logo, cover } = req.validated!.body as {
    name: string;
    slug: string;
    logo: string;
    cover?: string;
  };
  const coffee = await createCoffee({ name, slug, logo, cover });
  sendSuccess(res, coffee, 201);
}

/** GET /api/v1/admin/coffees/:coffeeId */
export async function getAdminCoffeeController(req: Request, res: Response): Promise<void> {
  const { coffeeId } = req.validated!.params as { coffeeId: string };
  const coffee = await getCoffee(coffeeId);
  sendSuccess(res, coffee);
}

/** PATCH /api/v1/admin/coffees/:coffeeId */
export async function updateAdminCoffeeController(req: Request, res: Response): Promise<void> {
  const { coffeeId } = req.validated!.params as { coffeeId: string };
  const body = req.validated!.body as { name?: string; logo?: string; cover?: string; slug?: string };
  const coffee = await updateCoffee(coffeeId, body);
  sendSuccess(res, coffee);
}

/** DELETE /api/v1/admin/coffees/:coffeeId */
export async function deleteAdminCoffeeController(req: Request, res: Response): Promise<void> {
  const { coffeeId } = req.validated!.params as { coffeeId: string };
  const result = await deleteCoffee(coffeeId);
  sendSuccess(res, result);
}

/** PATCH /api/v1/admin/coffees/:coffeeId/pin — app admin resets a coffee PIN. */
export async function resetAdminCoffeePinController(req: Request, res: Response): Promise<void> {
  const { coffeeId } = req.validated!.params as { coffeeId: string };
  const result = await resetCoffeePin(coffeeId);
  sendSuccess(res, result);
}
