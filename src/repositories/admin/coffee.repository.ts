import { Types } from "mongoose";
import { CoffeeModel } from "../../models/coffee.model.js";
import { ItemCategoryModel } from "../../models/item-category.model.js";
import { ItemModel } from "../../models/item.model.js";
import { OfferModel } from "../../models/offer.model.js";

/**
 * Application-admin coffee data access. Never returns `adminPinHash` — every
 * query restricts the projected fields so PIN material can never leak out of
 * the repository layer.
 */

const SAFE_FIELDS = {
  name: 1,
  slug: 1,
  logo: 1,
  logoImageId: 1,
  cover: 1,
  coverImageId: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

export interface AdminCoffeeCreateInput {
  name: string;
  logo: string;
  slug: string;
  adminPinHash: string;
  logoImageId?: string | null;
  cover?: string | null;
  coverImageId?: string | null;
}

export interface AdminCoffeeRow {
  _id: Types.ObjectId;
  name: string;
  logo: string;
  logoImageId: string | null;
  cover: string | null;
  coverImageId: string | null;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
  categoryCount: number;
}

export function isValidObjectId(value: string): boolean {
  return Types.ObjectId.isValid(value);
}

export async function findAdminCoffeeById(id: string): Promise<AdminCoffeeRow | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const coffee = await CoffeeModel.findById(id).select(SAFE_FIELDS).lean().exec();
  if (!coffee) return null;
  const categoryCount = await ItemCategoryModel.countDocuments({ coffeeId: coffee._id });
  return {
    ...coffee,
    logoImageId: coffee.logoImageId ?? null,
    cover: coffee.cover ?? null,
    coverImageId: coffee.coverImageId ?? null,
    categoryCount,
  };
}

export async function listAdminCoffees(): Promise<AdminCoffeeRow[]> {
  const coffees = await CoffeeModel.find().select(SAFE_FIELDS).sort({ name: 1 }).lean().exec();

  const counts = await ItemCategoryModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $group: { _id: "$coffeeId", count: { $sum: 1 } } },
  ]);
  const countByCoffeeId = new Map(counts.map((entry) => [entry._id.toString(), entry.count]));

  return coffees.map((coffee) => ({
    ...coffee,
    logoImageId: coffee.logoImageId ?? null,
    cover: coffee.cover ?? null,
    coverImageId: coffee.coverImageId ?? null,
    categoryCount: countByCoffeeId.get(coffee._id.toString()) ?? 0,
  }));
}

export async function createAdminCoffee(input: AdminCoffeeCreateInput): Promise<AdminCoffeeRow> {
  // Field-by-field mapping (never a blind spread of `toObject()`): the created
  // document carries `adminPinHash`, and spreading the whole object at runtime
  // would hand PIN material out of the repository — exactly what SAFE_FIELDS
  // is designed to prevent on the read path.
  const coffee = await CoffeeModel.create({ ...input });
  const doc = coffee.toObject({ versionKey: false });
  return {
    _id: doc._id,
    name: doc.name,
    logo: doc.logo,
    logoImageId: doc.logoImageId ?? null,
    cover: doc.cover ?? null,
    coverImageId: doc.coverImageId ?? null,
    slug: doc.slug,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    categoryCount: 0,
  };
}

/** Returns a coffee's stored PIN hash only (used by the auth service). */
export async function findCoffeeWithPinHashBySlug(
  slug: string,
): Promise<{ _id: Types.ObjectId; adminPinHash?: string | null } | null> {
  const coffee = await CoffeeModel.findOne({ slug }).select({ adminPinHash: 1 }).lean().exec();
  if (!coffee) return null;
  return { _id: coffee._id, adminPinHash: coffee.adminPinHash };
}

export async function findCoffeeWithPinHashById(
  id: string,
): Promise<{ _id: Types.ObjectId; adminPinHash?: string | null } | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const coffee = await CoffeeModel.findById(id).select({ adminPinHash: 1 }).lean().exec();
  if (!coffee) return null;
  return { _id: coffee._id, adminPinHash: coffee.adminPinHash };
}

/** True when the slug is already taken, optionally ignoring one coffee. */
export async function isCoffeeSlugTaken(slug: string, excludeId?: string): Promise<boolean> {
  const filter: Record<string, unknown> = { slug };
  if (excludeId && Types.ObjectId.isValid(excludeId)) {
    filter._id = { $ne: new Types.ObjectId(excludeId) };
  }
  const existing = await CoffeeModel.exists(filter);
  return existing !== null;
}

export async function updateAdminCoffee(
  id: string,
  patch: Partial<{
    name: string;
    logo: string;
    slug: string;
    logoImageId: string | null;
    cover: string | null;
    coverImageId: string | null;
  }>,
): Promise<AdminCoffeeRow | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const coffee = await CoffeeModel.findByIdAndUpdate(id, patch, {
    returnDocument: "after",
    runValidators: true,
  })
    .select(SAFE_FIELDS)
    .lean()
    .exec();
  if (!coffee) return null;
  const categoryCount = await ItemCategoryModel.countDocuments({ coffeeId: coffee._id });
  return {
    ...coffee,
    logoImageId: coffee.logoImageId ?? null,
    cover: coffee.cover ?? null,
    coverImageId: coffee.coverImageId ?? null,
    categoryCount,
  };
}

export async function updateCoffeePinHash(id: string, adminPinHash: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const result = await CoffeeModel.updateOne({ _id: id }, { adminPinHash });
  return result.matchedCount > 0;
}

/**
 * Deliberate cascading delete: the coffee's categories are resolved first,
 * their items are removed, then the categories, then the coffee itself.
 *
 * The order guarantees a failed run never leaves items orphaned from a
 * surviving category — the innermost (item) data goes first. On a replica-set
 * deployment the same ordered deletes should be wrapped in a multi-document
 * transaction; on the standalone dev MongoDB that is not available, so the
 * deterministic order is the safety mechanism.
 */
export async function deleteCoffeeWithDependencies(id: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const coffeeId = new Types.ObjectId(id);

  const categories = await ItemCategoryModel.find({ coffeeId }).select({ _id: 1 }).lean().exec();
  const categoryIds = categories.map((category) => category._id);

  if (categoryIds.length > 0) {
    await ItemModel.deleteMany({ itemCategoryId: { $in: categoryIds } });
    await ItemCategoryModel.deleteMany({ _id: { $in: categoryIds } });
  }

  await OfferModel.deleteMany({ coffeeId });

  const result = await CoffeeModel.deleteOne({ _id: coffeeId });
  return result.deletedCount > 0;
}
