import { findCoffeeWithCategoriesBySlug } from "../repositories/coffee.repository.js";
import type { CoffeeWithCategoriesDto } from "../types/index.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Resolves a coffee by its public slug together with its own categories.
 * Throws a 404 when the slug does not exist.
 */
export async function getCoffeeBySlug(slug: string): Promise<CoffeeWithCategoriesDto> {
  const coffee = await findCoffeeWithCategoriesBySlug(slug);
  if (!coffee) {
    throw new ApiError(404, "Coffee not found");
  }
  return coffee;
}
