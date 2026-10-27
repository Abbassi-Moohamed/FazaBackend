import type { Request, Response } from "express";
import {
  createItem,
  deleteItem,
  listItems,
  updateItem,
  type ItemMediaInput,
} from "../../../services/admin/coffee-admin.service.js";
import { sendSuccess } from "../../../utils/http.js";

function adminCoffeeId(req: Request): string {
  return req.admin!.coffeeId!;
}

/** GET /api/v1/admin/my-coffee/categories/:categoryId/items */
export async function listMyCategoryItemsController(req: Request, res: Response): Promise<void> {
  const { categoryId } = req.validated!.params as { categoryId: string };
  const items = await listItems(adminCoffeeId(req), categoryId);
  sendSuccess(res, items);
}

/** POST /api/v1/admin/my-coffee/categories/:categoryId/items */
export async function createMyItemController(req: Request, res: Response): Promise<void> {
  const { categoryId } = req.validated!.params as { categoryId: string };
  const body = req.validated!.body as {
    name: string;
    description?: string;
    price: number;
    image?: string;
    media?: ItemMediaInput[];
  };
  const item = await createItem(adminCoffeeId(req), categoryId, body);
  sendSuccess(res, item, 201);
}

/** PATCH /api/v1/admin/my-coffee/items/:itemId */
export async function updateMyItemController(req: Request, res: Response): Promise<void> {
  const { itemId } = req.validated!.params as { itemId: string };
  const body = req.validated!.body as {
    name?: string;
    description?: string;
    price?: number;
    image?: string;
    media?: ItemMediaInput[];
  };
  const item = await updateItem(adminCoffeeId(req), itemId, body);
  sendSuccess(res, item);
}

/** DELETE /api/v1/admin/my-coffee/items/:itemId */
export async function deleteMyItemController(req: Request, res: Response): Promise<void> {
  const { itemId } = req.validated!.params as { itemId: string };
  const result = await deleteItem(adminCoffeeId(req), itemId);
  sendSuccess(res, result);
}
