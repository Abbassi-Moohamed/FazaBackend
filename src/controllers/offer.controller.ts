import type { Request, Response } from "express";
import { getFeaturedOffers } from "../services/admin/offer.service.js";
import { sendSuccess } from "../utils/http.js";

/** Today's offers for the public menu of one coffee. */
export async function getCoffeeOffersController(req: Request, res: Response): Promise<void> {
  const { coffeeSlug } = req.validated!.params as { coffeeSlug: string };
  sendSuccess(res, await getFeaturedOffers(coffeeSlug));
}
