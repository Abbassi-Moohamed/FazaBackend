import { ItemModel } from "../models/item.model.js";
import { ItemCategoryModel } from "../models/item-category.model.js";

export interface ItemRecord {
  id: string;
  name: string;
  description: string | null;
  price: number;
  promotion: number | null;
  isAvailable: boolean;
  image: string | null;
}

export interface CategoryWithItemsRecord {
  id: string;
  name: string;
  image: string | null;
  items: ItemRecord[];
}

/**
 * Data access for category → items. The items query is scoped by the
 * category's own `itemCategoryId`, so the result can only ever contain
 * items of the requested category.
 */
export async function findCategoryWithItemsById(categoryId: string): Promise<CategoryWithItemsRecord | null> {
  const category = await ItemCategoryModel.findById(categoryId).select({ name: 1, image: 1 }).lean().exec();
  if (!category) return null;

  const items = await ItemModel.find({ itemCategoryId: category._id })
    .sort({ name: 1 })
    .select({ name: 1, description: 1, price: 1, promotion: 1, isAvailable: 1, image: 1 })
    .lean()
    .exec();

  return {
    id: category._id.toString(),
    name: category.name,
    image: category.image ?? null,
    items: items.map((item) => ({
      id: item._id.toString(),
      name: item.name,
      description: item.description ?? null,
      price: item.price,
      promotion: item.promotion ?? null,
      isAvailable: item.isAvailable ?? true,
      image: item.image ?? null,
    })),
  };
}
