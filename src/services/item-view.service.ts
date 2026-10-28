import { CoffeeModel } from "../models/coffee.model.js";
import { ItemCategoryModel } from "../models/item-category.model.js";
import { ItemModel } from "../models/item.model.js";
import { ItemViewModel } from "../models/item-view.model.js";
import { ApiError } from "../utils/ApiError.js";

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

/** Records one privacy-preserving daily aggregate for an available menu item. */
export async function recordPublicItemView(coffeeSlug: string, itemId: string): Promise<{ recorded: true }> {
  const coffee = await CoffeeModel.findOne({ slug: coffeeSlug }).select({ _id: 1 }).lean().exec();
  if (!coffee) throw new ApiError(404, "Coffee not found");

  const item = await ItemModel.findOne({ _id: itemId, isAvailable: { $ne: false } })
    .select({ _id: 1, itemCategoryId: 1 })
    .lean()
    .exec();
  if (!item) throw new ApiError(404, "Item not found");

  const category = await ItemCategoryModel.exists({ _id: item.itemCategoryId, coffeeId: coffee._id });
  if (!category) throw new ApiError(404, "Item not found");

  const now = new Date();
  const viewDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const filter = { coffeeId: coffee._id, itemId: item._id, viewDate };
  try {
    await ItemViewModel.updateOne(filter, { $inc: { views: 1 } }, { upsert: true }).exec();
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await ItemViewModel.updateOne(filter, { $inc: { views: 1 } }).exec();
  }

  return { recorded: true };
}
