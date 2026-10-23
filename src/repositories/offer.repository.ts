import { Types } from "mongoose";
import { ItemCategoryModel } from "../models/item-category.model.js";
import { ItemModel } from "../models/item.model.js";
import { OfferModel } from "../models/offer.model.js";

/**
 * Offer data access. Every query that can be reached from the backoffice is
 * scoped by `coffeeId`; the ones reached by a visitor are scoped by an
 * already-resolved `coffeeId` AND by the availability window.
 */

export interface OfferLineRow {
  itemId: Types.ObjectId;
  quantity: number;
}

export interface OfferRow {
  _id: Types.ObjectId;
  coffeeId: Types.ObjectId;
  name: string;
  description: string | null;
  price: number;
  lines: OfferLineRow[];
  stock: number;
  image: string | null;
  imageId: string | null;
  startAt: Date | null;
  endAt: Date | null;
  isActive: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OfferCreateInput {
  name: string;
  description?: string | null;
  price: number;
  lines: { itemId: Types.ObjectId; quantity: number }[];
  stock: number;
  image?: string | null;
  imageId?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  isActive?: boolean;
}

export type OfferPatch = Partial<OfferCreateInput> & { archivedAt?: Date | null };

export interface OfferLineItemRow {
  _id: Types.ObjectId;
  name: string;
  image: string | null;
  price: number;
  promotion: number | null;
  isAvailable: boolean;
}

const SAFE_FIELDS = {
  coffeeId: 1,
  name: 1,
  description: 1,
  price: 1,
  lines: 1,
  stock: 1,
  image: 1,
  imageId: 1,
  startAt: 1,
  endAt: 1,
  isActive: 1,
  archivedAt: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

function toRow(offer: {
  _id: Types.ObjectId;
  coffeeId: Types.ObjectId;
  name: string;
  description?: string | null;
  price: number;
  lines: { itemId: Types.ObjectId; quantity: number }[];
  stock: number;
  image?: string | null;
  imageId?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  isActive?: boolean;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): OfferRow {
  return {
    _id: offer._id,
    coffeeId: offer.coffeeId,
    name: offer.name,
    description: offer.description ?? null,
    price: offer.price,
    lines: offer.lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity })),
    stock: offer.stock,
    image: offer.image ?? null,
    imageId: offer.imageId ?? null,
    startAt: offer.startAt ?? null,
    endAt: offer.endAt ?? null,
    isActive: offer.isActive ?? true,
    archivedAt: offer.archivedAt ?? null,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
}

/** The filter matching an offer that may be sold at `at` (window-wise). */
function availabilityWindow(at: Date) {
  return {
    $and: [{ $or: [{ startAt: null }, { startAt: { $lte: at } }] }, { $or: [{ endAt: null }, { endAt: { $gt: at } }] }],
  };
}

export async function listOffersOfCoffee(coffeeId: string, includeArchived = false): Promise<OfferRow[]> {
  if (!Types.ObjectId.isValid(coffeeId)) return [];
  const offers = await OfferModel.find({ coffeeId, ...(includeArchived ? {} : { archivedAt: null }) })
    .sort({ createdAt: -1 })
    .select(SAFE_FIELDS)
    .lean()
    .exec();
  return offers.map(toRow);
}

export async function findOfferOwnedByCoffee(coffeeId: string, offerId: string): Promise<OfferRow | null> {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(offerId)) return null;
  const offer = await OfferModel.findOne({ _id: offerId, coffeeId }).select(SAFE_FIELDS).lean().exec();
  return offer ? toRow(offer) : null;
}

export async function createOfferForCoffee(coffeeId: string, input: OfferCreateInput): Promise<OfferRow> {
  const offer = await OfferModel.create({ ...input, coffeeId });
  return toRow(offer);
}

export async function updateOfferOwnedByCoffee(
  coffeeId: string,
  offerId: string,
  patch: OfferPatch,
): Promise<OfferRow | null> {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(offerId)) return null;
  const updated = await OfferModel.findOneAndUpdate(
    { _id: offerId, coffeeId },
    { $set: patch },
    {
      returnDocument: "after",
      runValidators: true,
    },
  )
    .select(SAFE_FIELDS)
    .lean()
    .exec();
  return updated ? toRow(updated) : null;
}

export async function deleteOfferOwnedByCoffee(coffeeId: string, offerId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(offerId)) return false;
  const result = await OfferModel.deleteOne({ _id: offerId, coffeeId }).exec();
  return result.deletedCount === 1;
}

/** Offers a visitor can buy right now: active, in window, still in stock. */
export async function listFeaturedOffers(coffeeId: string, at: Date): Promise<OfferRow[]> {
  if (!Types.ObjectId.isValid(coffeeId)) return [];
  const offers = await OfferModel.find({
    coffeeId,
    archivedAt: null,
    isActive: true,
    stock: { $gt: 0 },
    ...availabilityWindow(at),
  })
    .sort({ createdAt: -1 })
    .select(SAFE_FIELDS)
    .lean()
    .exec();
  return offers.map(toRow);
}

/** An offer that can be purchased at `at` (window-wise; stock is checked atomically). */
export async function findPurchasableOffer(coffeeId: string, offerId: string, at: Date): Promise<OfferRow | null> {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(offerId)) return null;
  const offer = await OfferModel.findOne({
    _id: offerId,
    coffeeId,
    archivedAt: null,
    isActive: true,
    ...availabilityWindow(at),
  })
    .select(SAFE_FIELDS)
    .lean()
    .exec();
  return offer ? toRow(offer) : null;
}

/**
 * Atomically reserves `quantity` bundles. The filter re-checks every sale
 * condition inside the same write, so two concurrent orders can never sell
 * more bundles than the stock (no transactions needed on a standalone Mongo).
 * Returns null when the offer is no longer purchasable / out of stock.
 */
export async function consumeOfferStock(
  coffeeId: string,
  offerId: string,
  quantity: number,
  at: Date,
): Promise<OfferRow | null> {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(offerId) || quantity <= 0) return null;
  const updated = await OfferModel.findOneAndUpdate(
    {
      _id: offerId,
      coffeeId,
      archivedAt: null,
      isActive: true,
      stock: { $gte: quantity },
      ...availabilityWindow(at),
    },
    { $inc: { stock: -quantity } },
    { returnDocument: "after", runValidators: true },
  )
    .select(SAFE_FIELDS)
    .lean()
    .exec();
  return updated ? toRow(updated) : null;
}

/** Compensating write used when an order fails after its stock was reserved. */
export async function restoreOfferStock(offerId: Types.ObjectId, quantity: number): Promise<void> {
  if (quantity <= 0) return;
  await OfferModel.updateOne({ _id: offerId }, { $inc: { stock: quantity } }).exec();
}

/** Resolves the component items of offers, scoped to the coffee's categories. */
export async function findItemsForOfferLines(coffeeId: string, itemIds: string[]): Promise<OfferLineItemRow[]> {
  if (!Types.ObjectId.isValid(coffeeId)) return [];
  const ids = [...new Set(itemIds.filter((id) => Types.ObjectId.isValid(id)))];
  if (ids.length === 0) return [];

  const categories = await ItemCategoryModel.find({ coffeeId }).select({ _id: 1 }).lean().exec();
  const items = await ItemModel.find({
    _id: { $in: ids },
    itemCategoryId: { $in: categories.map((category) => category._id) },
  })
    .select({ name: 1, image: 1, price: 1, promotion: 1, isAvailable: 1 })
    .lean()
    .exec();

  return items.map((item) => ({
    _id: item._id,
    name: item.name,
    image: item.image ?? null,
    price: item.price,
    promotion: item.promotion ?? null,
    isAvailable: item.isAvailable ?? true,
  }));
}

/** All Cloudflare image ids attached to offers of a coffee. */
export async function listOfferImageIdsOfCoffee(coffeeId: string): Promise<string[]> {
  if (!Types.ObjectId.isValid(coffeeId)) return [];
  const offers = await OfferModel.find({ coffeeId }).select({ imageId: 1 }).lean().exec();
  return offers
    .map((offer) => offer.imageId)
    .filter((imageId): imageId is string => imageId !== null && imageId !== undefined);
}

/**
 * Removes an item from every offer of the coffee. Offers left without any
 * component are archived instead of dangling with an empty bundle.
 */
export async function detachItemFromOffers(coffeeId: string, itemId: string): Promise<void> {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(itemId)) return;
  await OfferModel.updateMany(
    { coffeeId, "lines.itemId": new Types.ObjectId(itemId) },
    { $pull: { lines: { itemId: new Types.ObjectId(itemId) } } },
  ).exec();
  await OfferModel.updateMany(
    { coffeeId, lines: { $size: 0 }, archivedAt: null },
    { $set: { archivedAt: new Date() } },
  ).exec();
}
