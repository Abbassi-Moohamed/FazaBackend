import { Types } from "mongoose";
import { CoffeeModel } from "../../models/coffee.model.js";
import type { OfferStatus } from "../../models/offer.model.js";
import {
  createOfferForCoffee,
  findItemsForOfferLines,
  findOfferOwnedByCoffee,
  listFeaturedOffers,
  listOffersOfCoffee,
  updateOfferOwnedByCoffee,
  type OfferLineItemRow,
  type OfferPatch,
  type OfferRow,
} from "../../repositories/offer.repository.js";
import type { AdminContext, AdminOfferDto, FeaturedOfferDto, OfferLineDto } from "../../types/index.js";
import { ApiError } from "../../utils/ApiError.js";
import { attachImageToEntity, deleteImage, resolveImageForEntity } from "../image.service.js";

/**
 * Daily offers. The admin side is scoped to the authenticated coffee; the
 * public side only ever exposes offers that are active, inside their window
 * and in stock, with every component available. Prices of the components are
 * always read live from the menu; nothing is copied except at order time.
 */

export interface OfferLineInput {
  itemId: string;
  quantity: number;
}

export interface CreateOfferInput {
  name: string;
  description?: string;
  price: number;
  stock: number;
  lines: OfferLineInput[];
  image?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  isActive?: boolean;
}

export interface UpdateOfferInput {
  name?: string;
  description?: string;
  price?: number;
  stock?: number;
  lines?: OfferLineInput[];
  image?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  isActive?: boolean;
  archived?: boolean;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Lifecycle of an offer, derived from its flags, stock and the clock. */
export function offerStatus(
  offer: {
    isActive: boolean;
    archivedAt: Date | null;
    stock: number;
    startAt: Date | null;
    endAt: Date | null;
  },
  at: Date = new Date(),
): OfferStatus {
  if (offer.archivedAt) return "ARCHIVED";
  if (!offer.isActive) return "PAUSED";
  if (offer.startAt && offer.startAt.getTime() > at.getTime()) return "SCHEDULED";
  if (offer.endAt && offer.endAt.getTime() <= at.getTime()) return "EXPIRED";
  if (offer.stock <= 0) return "SOLD_OUT";
  return "ACTIVE";
}

function parseWindowDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ApiError(400, "Date must be a valid ISO date.");
  return parsed;
}

function assertValidWindow(startAt: Date | null, endAt: Date | null): void {
  if (startAt && endAt && startAt.getTime() >= endAt.getTime()) {
    throw new ApiError(400, "The end date must be after the start date.");
  }
}

function assertDealPrice(price: number, originalPrice: number): void {
  if (round(price) >= round(originalPrice)) {
    throw new ApiError(400, "The offer price must be lower than the sum of its items.");
  }
}

/** Prices the offered lines from the live menu, failing closed on foreign ids. */
async function priceComponents(
  coffeeId: string,
  lines: OfferLineInput[],
): Promise<{ lines: OfferLineDto[]; originalPrice: number }> {
  const items = await findItemsForOfferLines(
    coffeeId,
    lines.map((line) => line.itemId),
  );
  const byId = new Map(items.map((item) => [item._id.toString(), item]));
  if (byId.size !== new Set(lines.map((line) => line.itemId)).size) {
    throw new ApiError(400, "One or more items do not belong to this coffee.");
  }

  const priced = lines.map((line) => {
    const item = byId.get(line.itemId);
    if (!item) throw new ApiError(400, "One or more items do not belong to this coffee.");
    return {
      itemId: item._id.toString(),
      name: item.name,
      image: item.image,
      quantity: line.quantity,
      unitPrice: item.promotion ?? item.price,
    };
  });

  const originalPrice = round(priced.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
  return { lines: priced, originalPrice };
}

function linesFromMap(offer: OfferRow, byId: Map<string, OfferLineItemRow>): OfferLineDto[] {
  return offer.lines.flatMap((line) => {
    const item = byId.get(line.itemId.toString());
    if (!item) return [];
    return [
      {
        itemId: item._id.toString(),
        name: item.name,
        image: item.image,
        quantity: line.quantity,
        unitPrice: item.promotion ?? item.price,
      },
    ];
  });
}

function toAdminDto(offer: OfferRow, lines: OfferLineDto[]): AdminOfferDto {
  const originalPrice = round(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
  return {
    id: offer._id.toString(),
    name: offer.name,
    description: offer.description,
    price: offer.price,
    image: offer.image,
    originalPrice,
    savings: Math.max(0, round(originalPrice - offer.price)),
    stock: offer.stock,
    startAt: offer.startAt,
    endAt: offer.endAt,
    status: offerStatus(offer),
    lines,
    isActive: offer.isActive,
    archivedAt: offer.archivedAt,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
}

/** Prices every offer with one menu query (no per-offer round-trip). */
async function toAdminDtos(coffeeId: string, offers: OfferRow[]): Promise<AdminOfferDto[]> {
  if (offers.length === 0) return [];
  const items = await findItemsForOfferLines(
    coffeeId,
    offers.flatMap((offer) => offer.lines.map((line) => line.itemId.toString())),
  );
  const byId = new Map(items.map((item) => [item._id.toString(), item]));
  return offers.map((offer) => toAdminDto(offer, linesFromMap(offer, byId)));
}

export async function listOffers(coffeeId: string): Promise<AdminOfferDto[]> {
  return toAdminDtos(coffeeId, await listOffersOfCoffee(coffeeId, true));
}

export async function createOffer(coffeeId: string, input: CreateOfferInput): Promise<AdminOfferDto> {
  const startAt = parseWindowDate(input.startAt);
  const endAt = parseWindowDate(input.endAt);
  assertValidWindow(startAt, endAt);

  const priced = await priceComponents(coffeeId, input.lines);
  assertDealPrice(input.price, priced.originalPrice);

  const admin: AdminContext = { role: "COFFEE_ADMIN", coffeeId };
  let image: string | null = input.image ?? null;
  let imageId: string | null = null;
  if (image !== null) {
    const resolved = await resolveImageForEntity({ url: image, admin });
    image = resolved.url;
    imageId = resolved.imageId;
  }

  const offer = await createOfferForCoffee(coffeeId, {
    name: input.name,
    description: input.description ?? null,
    price: input.price,
    stock: input.stock,
    lines: input.lines.map((line) => ({ itemId: new Types.ObjectId(line.itemId), quantity: line.quantity })),
    image,
    imageId,
    startAt,
    endAt,
    isActive: input.isActive ?? true,
  });

  if (imageId) await attachImageToEntity(imageId, coffeeId);
  const [dto] = await toAdminDtos(coffeeId, [offer]);
  return dto!;
}

export async function updateOffer(coffeeId: string, offerId: string, input: UpdateOfferInput): Promise<AdminOfferDto> {
  const existing = await findOfferOwnedByCoffee(coffeeId, offerId);
  if (!existing) throw new ApiError(404, "Offer not found");

  const lines =
    input.lines ?? existing.lines.map((line) => ({ itemId: line.itemId.toString(), quantity: line.quantity }));
  const price = input.price ?? existing.price;
  const priced = await priceComponents(coffeeId, lines);
  assertDealPrice(price, priced.originalPrice);

  const startAt = input.startAt !== undefined ? parseWindowDate(input.startAt) : existing.startAt;
  const endAt = input.endAt !== undefined ? parseWindowDate(input.endAt) : existing.endAt;
  assertValidWindow(startAt, endAt);

  const admin: AdminContext = { role: "COFFEE_ADMIN", coffeeId };
  const patch: OfferPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.price !== undefined) patch.price = input.price;
  if (input.stock !== undefined) patch.stock = input.stock;
  if (input.lines !== undefined) {
    patch.lines = input.lines.map((line) => ({ itemId: new Types.ObjectId(line.itemId), quantity: line.quantity }));
  }
  if (input.startAt !== undefined) patch.startAt = startAt;
  if (input.endAt !== undefined) patch.endAt = endAt;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.archived !== undefined) patch.archivedAt = input.archived ? (existing.archivedAt ?? new Date()) : null;

  let newImageId: string | null | undefined;
  if (input.image !== undefined) {
    if (input.image === null) {
      patch.image = null;
      patch.imageId = null;
      newImageId = null;
    } else {
      const resolved = await resolveImageForEntity({ url: input.image, admin });
      patch.image = resolved.url;
      patch.imageId = resolved.imageId;
      newImageId = resolved.imageId;
    }
  }

  const updated = await updateOfferOwnedByCoffee(coffeeId, offerId, patch);
  if (!updated) throw new ApiError(404, "Offer not found");

  if (newImageId) await attachImageToEntity(newImageId, coffeeId);
  if (input.image !== undefined && existing.imageId !== null && existing.imageId !== newImageId) {
    await deleteImage(existing.imageId, { coffeeId, offerId });
  }

  const [dto] = await toAdminDtos(coffeeId, [updated]);
  return dto!;
}

/** Archiving is the delete: it keeps the offer's history and is reversible. */
export async function archiveOffer(coffeeId: string, offerId: string): Promise<{ id: string }> {
  const existing = await findOfferOwnedByCoffee(coffeeId, offerId);
  if (!existing) throw new ApiError(404, "Offer not found");
  if (existing.archivedAt === null) {
    const updated = await updateOfferOwnedByCoffee(coffeeId, offerId, { archivedAt: new Date() });
    if (!updated) throw new ApiError(404, "Offer not found");
  }
  return { id: offerId };
}

/** The offers a visitor can buy right now, with live component prices. */
export async function getFeaturedOffers(coffeeSlug: string): Promise<FeaturedOfferDto[]> {
  const coffee = await CoffeeModel.findOne({ slug: coffeeSlug }).select({ _id: 1 }).lean().exec();
  if (!coffee) throw new ApiError(404, "Coffee not found");

  const coffeeId = coffee._id.toString();
  const offers = await listFeaturedOffers(coffeeId, new Date());
  if (offers.length === 0) return [];

  const items = await findItemsForOfferLines(
    coffeeId,
    offers.flatMap((offer) => offer.lines.map((line) => line.itemId.toString())),
  );
  const byId = new Map(items.map((item) => [item._id.toString(), item]));

  return offers.flatMap((offer) => {
    // An offer with a missing or unavailable component is not purchasable.
    if (offer.lines.some((line) => byId.get(line.itemId.toString())?.isAvailable === false)) return [];
    const lines = linesFromMap(offer, byId);
    if (lines.length !== offer.lines.length) return [];

    const dto = toAdminDto(offer, lines);
    return [
      {
        id: dto.id,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        image: dto.image ?? lines.find((line) => line.image !== null)?.image ?? null,
        originalPrice: dto.originalPrice,
        savings: dto.savings,
        stock: dto.stock,
        startAt: dto.startAt,
        endAt: dto.endAt,
        status: dto.status,
        lines: dto.lines,
      },
    ];
  });
}
