import { CoffeeModel } from "../models/coffee.model.js";
import { ItemCategoryModel } from "../models/item-category.model.js";
import { ItemModel } from "../models/item.model.js";

export interface CategoryRecord {
  id: string;
  name: string;
  image: string | null;
  itemCount: number;
}

export interface CoffeeWithCategoriesRecord {
  id: string;
  name: string;
  logo: string;
  cover: string | null;
  slug: string;
  categories: CategoryRecord[];
}

/**
 * Data access for the public coffee resolution. Queries are scoped by the
 * coffee's own slug; categories are loaded strictly through the `coffeeId`
 * relation so no other coffee's data can ever leak into the result.
 */
export async function findCoffeeWithCategoriesBySlug(slug: string): Promise<CoffeeWithCategoriesRecord | null> {
  const coffee = await CoffeeModel.findOne({ slug }).lean().exec();
  if (!coffee) return null;

  const categories = await ItemCategoryModel.find({ coffeeId: coffee._id })
    .sort({ name: 1 })
    .select({ name: 1, image: 1 })
    .lean()
    .exec();

  // Single grouped query for every category's item count (no per-category N+1).
  const categoryIds = categories.map((category) => category._id);
  const counts =
    categoryIds.length === 0
      ? []
      : await ItemModel.aggregate<{ _id: unknown; count: number }>([
          { $match: { itemCategoryId: { $in: categoryIds } } },
          { $group: { _id: "$itemCategoryId", count: { $sum: 1 } } },
        ]).exec();
  const countById = new Map(counts.map((entry) => [String(entry._id), entry.count]));

  return {
    id: coffee._id.toString(),
    name: coffee.name,
    logo: coffee.logo,
    cover: coffee.cover ?? null,
    slug: coffee.slug,
    categories: categories.map((category) => ({
      id: category._id.toString(),
      name: category.name,
      image: category.image ?? null,
      itemCount: countById.get(category._id.toString()) ?? 0,
    })),
  };
}
