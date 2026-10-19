import { Types } from "mongoose";
import { ItemCategoryModel } from "../../models/item-category.model.js";
import { ItemModel } from "../../models/item.model.js";

/**
 * Coffee-admin category data access. Every query is scoped by BOTH the
 * target category id AND the owning coffee id — knowing another coffee's
 * ObjectId is never enough to touch its categories.
 */

export interface AdminCategoryRow {
  _id: Types.ObjectId;
  name: string;
  image: string | null;
  imageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
}

const SAFE_FIELDS = { name: 1, image: 1, imageId: 1, createdAt: 1, updatedAt: 1 } as const;

function toRow(category: {
  _id: Types.ObjectId;
  name: string;
  image?: string | null;
  imageId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AdminCategoryRow {
  return {
    _id: category._id,
    name: category.name,
    image: category.image ?? null,
    imageId: category.imageId ?? null,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    itemCount: 0,
  };
}

export async function listCategoriesOfCoffee(coffeeId: string): Promise<AdminCategoryRow[]> {
  if (!Types.ObjectId.isValid(coffeeId)) return [];
  const categories = await ItemCategoryModel.find({ coffeeId }).sort({ name: 1 }).select(SAFE_FIELDS).lean().exec();
  const counts = await ItemModel.aggregate([
    { $match: { itemCategoryId: { $in: categories.map((category) => category._id) } } },
    { $group: { _id: "$itemCategoryId", count: { $sum: 1 } } },
  ]).exec();
  const countByCategory = new Map(counts.map((row) => [row._id.toString(), Number(row.count)]));
  return categories.map((category) => ({
    ...toRow(category),
    itemCount: countByCategory.get(category._id.toString()) ?? 0,
  }));
}

export async function listCategoryImageIdsOfCoffee(coffeeId: string): Promise<string[]> {
  if (!Types.ObjectId.isValid(coffeeId)) return [];
  const categories = await ItemCategoryModel.find({ coffeeId, imageId: { $ne: null } })
    .select({ imageId: 1 })
    .lean()
    .exec();
  return categories.map((category) => category.imageId).filter((id): id is string => Boolean(id));
}

export async function createCategoryForCoffee(
  coffeeId: string,
  name: string,
  image?: string | null,
  imageId?: string | null,
): Promise<AdminCategoryRow> {
  const category = await ItemCategoryModel.create({ coffeeId, name, image: image ?? null, imageId: imageId ?? null });
  return {
    _id: category._id,
    name: category.name,
    image: category.image ?? null,
    imageId: category.imageId ?? null,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    itemCount: 0,
  };
}

/** Finds a category that belongs to the given coffee (ownership check). */
export async function findCategoryOwnedByCoffee(
  coffeeId: string,
  categoryId: string,
): Promise<AdminCategoryRow | null> {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(categoryId)) return null;
  const category = await ItemCategoryModel.findOne({ _id: categoryId, coffeeId }).lean().exec();
  return category ? toRow(category) : null;
}

export async function updateCategoryOwnedByCoffee(
  coffeeId: string,
  categoryId: string,
  name: string,
  image: string | null,
  imageId: string | null,
): Promise<AdminCategoryRow | null> {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(categoryId)) return null;
  const category = await ItemCategoryModel.findOneAndUpdate(
    { _id: categoryId, coffeeId },
    { name, image, imageId },
    { returnDocument: "after", runValidators: true },
  )
    .select(SAFE_FIELDS)
    .lean()
    .exec();
  return category ? toRow(category) : null;
}

/**
 * Deletes a category and every item it owns (dependency-order delete:
 * items first, then the category).
 */
export async function deleteCategoryOwnedByCoffee(coffeeId: string, categoryId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(categoryId)) return false;
  const category = await ItemCategoryModel.findOne({ _id: categoryId, coffeeId }).select({ _id: 1 }).lean().exec();
  if (!category) return false;

  await ItemModel.deleteMany({ itemCategoryId: category._id });
  await ItemCategoryModel.deleteOne({ _id: category._id });
  return true;
}
