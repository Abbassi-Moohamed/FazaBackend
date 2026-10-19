import { Types } from "mongoose";
import { ItemCategoryModel } from "../../models/item-category.model.js";
import { ItemModel } from "../../models/item.model.js";

/**
 * Coffee-admin item data access. Ownership is enforced by walking the full
 * chain item → itemCategory → coffee: an operation only succeeds when the
 * item's own category belongs to the authenticated coffee admin.
 */

export interface AdminItemRow {
  _id: Types.ObjectId;
  name: string;
  description: string | null;
  price: number;
  promotion: number | null;
  isAvailable: boolean;
  image: string | null;
  /** Cloudflare image id backing `image`, null for external URLs. */
  imageId: string | null;
  itemCategoryId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminItemCreateInput {
  name: string;
  description?: string | null;
  price: number;
  promotion?: number | null;
  isAvailable?: boolean;
  image?: string | null;
  imageId?: string | null;
}

const SAFE_FIELDS = {
  name: 1,
  description: 1,
  price: 1,
  promotion: 1,
  isAvailable: 1,
  image: 1,
  imageId: 1,
  itemCategoryId: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

function toRow(item: {
  _id: Types.ObjectId;
  name: string;
  description?: string | null;
  price: number;
  promotion?: number | null;
  isAvailable?: boolean;
  image?: string | null;
  imageId?: string | null;
  itemCategoryId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}): AdminItemRow {
  return {
    _id: item._id,
    name: item.name,
    description: item.description ?? null,
    price: item.price,
    promotion: item.promotion ?? null,
    isAvailable: item.isAvailable ?? true,
    image: item.image ?? null,
    imageId: item.imageId ?? null,
    itemCategoryId: item.itemCategoryId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function listItemsOfCategory(categoryId: string): Promise<AdminItemRow[]> {
  if (!Types.ObjectId.isValid(categoryId)) return [];
  const items = await ItemModel.find({ itemCategoryId: categoryId })
    .sort({ name: 1 })
    .select(SAFE_FIELDS)
    .lean()
    .exec();
  return items.map(toRow);
}

export async function createItemForCategory(categoryId: string, input: AdminItemCreateInput): Promise<AdminItemRow> {
  const item = await ItemModel.create({ ...input, itemCategoryId: categoryId });
  return toRow(item);
}

/**
 * Finds an item ONLY when its category belongs to the given coffee.
 * The two-step lookup walks item → itemCategory → coffee, failing closed when
 * any hop is missing or mismatched.
 */
export async function findItemOwnedByCoffee(coffeeId: string, itemId: string): Promise<AdminItemRow | null> {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(itemId)) return null;

  const item = await ItemModel.findById(itemId).select(SAFE_FIELDS).lean().exec();
  if (!item) return null;

  const category = await ItemCategoryModel.findById(item.itemCategoryId).select({ coffeeId: 1 }).lean().exec();
  if (!category || category.coffeeId.toString() !== coffeeId) return null;

  return toRow(item);
}

export async function updateItemOwnedByCoffee(
  coffeeId: string,
  itemId: string,
  patch: Partial<AdminItemCreateInput>,
): Promise<AdminItemRow | null> {
  const existing = await findItemOwnedByCoffee(coffeeId, itemId);
  if (!existing) return null;

  const cleanedPatch: Partial<AdminItemCreateInput> = {};
  if (patch.name !== undefined) cleanedPatch.name = patch.name;
  if (patch.description !== undefined) cleanedPatch.description = patch.description;
  if (patch.price !== undefined) cleanedPatch.price = patch.price;
  if (patch.promotion !== undefined) cleanedPatch.promotion = patch.promotion;
  if (patch.isAvailable !== undefined) cleanedPatch.isAvailable = patch.isAvailable;
  if (patch.image !== undefined) cleanedPatch.image = patch.image;
  if (patch.imageId !== undefined) cleanedPatch.imageId = patch.imageId;

  const updated = await ItemModel.findByIdAndUpdate(itemId, cleanedPatch, {
    returnDocument: "after",
    runValidators: true,
  })
    .select(SAFE_FIELDS)
    .lean()
    .exec();

  return updated ? toRow(updated) : null;
}

export async function deleteItemOwnedByCoffee(coffeeId: string, itemId: string): Promise<boolean> {
  const existing = await findItemOwnedByCoffee(coffeeId, itemId);
  if (!existing) return false;
  await ItemModel.deleteOne({ _id: existing._id });
  return true;
}

/** Cloudflare image ids of every item that belongs to the given coffee. */
export async function listItemImageIdsOfCoffee(coffeeId: string): Promise<string[]> {
  if (!Types.ObjectId.isValid(coffeeId)) return [];
  const categories = await ItemCategoryModel.find({ coffeeId }).select({ _id: 1 }).lean().exec();
  const categoryIds = categories.map((category) => category._id);
  if (categoryIds.length === 0) return [];

  const items = await ItemModel.find({ itemCategoryId: { $in: categoryIds } })
    .select({ imageId: 1 })
    .lean()
    .exec();
  return items
    .map((item) => item.imageId)
    .filter((imageId): imageId is string => imageId !== null && imageId !== undefined);
}
