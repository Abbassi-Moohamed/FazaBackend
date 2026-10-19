import { findCategoryWithItemsById } from "../repositories/category.repository.js";
import type { ItemDto } from "../types/index.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Returns only the items that belong to the requested category.
 * Throws a 404 when the category does not exist.
 */
export async function getItemsByCategoryId(categoryId: string): Promise<ItemDto[]> {
  const category = await findCategoryWithItemsById(categoryId);
  if (!category) {
    throw new ApiError(404, "Category not found");
  }
  return category.items;
}
