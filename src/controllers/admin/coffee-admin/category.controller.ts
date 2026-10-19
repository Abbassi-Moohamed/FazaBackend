import type { Request, Response } from "express";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "../../../services/admin/coffee-admin.service.js";
import { sendSuccess } from "../../../utils/http.js";

function adminCoffeeId(req: Request): string {
  return req.admin!.coffeeId!;
}

/** GET /api/v1/admin/my-coffee/categories */
export async function listMyCategoriesController(req: Request, res: Response): Promise<void> {
  const categories = await listCategories(adminCoffeeId(req));
  sendSuccess(res, categories);
}

/** POST /api/v1/admin/my-coffee/categories */
export async function createMyCategoryController(req: Request, res: Response): Promise<void> {
  const { name, image } = req.validated!.body as { name: string; image?: string };
  const category = await createCategory(adminCoffeeId(req), name, image);
  sendSuccess(res, category, 201);
}

/** PATCH /api/v1/admin/my-coffee/categories/:categoryId */
export async function updateMyCategoryController(req: Request, res: Response): Promise<void> {
  const { categoryId } = req.validated!.params as { categoryId: string };
  const { name, image } = req.validated!.body as { name: string; image?: string };
  const category = await updateCategory(adminCoffeeId(req), categoryId, name, image);
  sendSuccess(res, category);
}

/** DELETE /api/v1/admin/my-coffee/categories/:categoryId */
export async function deleteMyCategoryController(req: Request, res: Response): Promise<void> {
  const { categoryId } = req.validated!.params as { categoryId: string };
  const result = await deleteCategory(adminCoffeeId(req), categoryId);
  sendSuccess(res, result);
}
