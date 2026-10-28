import type { Request, Response } from "express";
import { recordPublicItemView } from "../services/item-view.service.js";
import { sendSuccess } from "../utils/http.js";

/** POST /api/v1/coffees/:coffeeSlug/items/:itemId/views */
export async function recordPublicItemViewController(req: Request, res: Response): Promise<void> {
  const { coffeeSlug, itemId } = req.validated!.params as { coffeeSlug: string; itemId: string };
  sendSuccess(res, await recordPublicItemView(coffeeSlug, itemId), 201);
}
