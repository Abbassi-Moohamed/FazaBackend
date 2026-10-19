import type { Request, Response } from "express";
import { getCoffeeBySlug } from "../services/coffee.service.js";
import { sendSuccess } from "../utils/http.js";

/** GET /api/v1/coffees/:coffeeSlug */
export async function getCoffeeBySlugController(req: Request, res: Response): Promise<void> {
  const { coffeeSlug } = req.validated!.params as { coffeeSlug: string };
  const coffee = await getCoffeeBySlug(coffeeSlug);
  sendSuccess(res, coffee);
}
