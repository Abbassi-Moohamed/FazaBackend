import type { Request, Response } from "express";
import { getItemsByCategoryId } from "../services/category.service.js";
import { sendSuccess } from "../utils/http.js";

/** GET /api/v1/categories/:categoryId/items */
export async function getItemsByCategoryController(req: Request, res: Response): Promise<void> {
  const { categoryId } = req.validated!.params as { categoryId: string };
  const items = await getItemsByCategoryId(categoryId);
  sendSuccess(res, items);
}
