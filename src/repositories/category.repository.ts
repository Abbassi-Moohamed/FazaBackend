import { ItemModel } from "../models/item.model.js";
import { ItemCategoryModel } from "../models/item-category.model.js";
import type { ItemMediaDto } from "../types/index.js";

export interface ItemRecord {
  id: string;
  name: string;
  description: string | null;
  price: number;
  promotion: number | null;
  isAvailable: boolean;
  image: string | null;
  media: ItemMediaDto[];
}

export interface CategoryWithItemsRecord {
  id: string;
  name: string;
  image: string | null;
  items: ItemRecord[];
}

interface ItemMediaRow {
  imageId?: string | null;
  url: string;
  type: "image" | "video";
  mimeType?: string | null;
  durationMs?: number | null;
  alt?: string | null;
}

function mediaFallback(
  media: readonly ItemMediaRow[] | undefined,
  image: string | null,
  imageId: string | null,
): ItemMediaDto[] {
  if (media && media.length > 0) {
    return media.map((entry) => ({
      imageId: entry.imageId ?? null,
      url: entry.url,
      type: entry.type,
      mimeType: entry.mimeType ?? null,
      durationMs: entry.durationMs ?? null,
      alt: entry.alt ?? null,
    }));
  }
  if (!image) return [];
  return [
    {
      imageId,
      url: image,
      type: "image",
      mimeType: null,
      durationMs: null,
      alt: null,
    },
  ];
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
    .select({ name: 1, description: 1, price: 1, promotion: 1, isAvailable: 1, image: 1, imageId: 1, media: 1 })
    .lean()
    .exec();

  return {
    id: category._id.toString(),
    name: category.name,
    image: category.image ?? null,
    items: items.map((item) => {
      const image = item.image ?? null;
      const imageId = item.imageId ?? null;
      return {
        id: item._id.toString(),
        name: item.name,
        description: item.description ?? null,
        price: item.price,
        promotion: item.promotion ?? null,
        isAvailable: item.isAvailable ?? true,
        image,
        media: mediaFallback(item.media, image, imageId),
      };
    }),
  };
}
