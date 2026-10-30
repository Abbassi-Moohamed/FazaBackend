import { hashPin, verifyPin } from "../../auth/pin.js";
import {
  findAdminCoffeeById,
  findCoffeeWithPinHashById,
  updateAdminCoffee,
  updateCoffeePinHash,
} from "../../repositories/admin/coffee.repository.js";
import {
  createCategoryForCoffee,
  deleteCategoryOwnedByCoffee,
  findCategoryOwnedByCoffee,
  listCategoriesOfCoffee,
  updateCategoryOwnedByCoffee,
} from "../../repositories/admin/category.repository.js";
import {
  createItemForCategory,
  deleteItemOwnedByCoffee,
  findItemOwnedByCoffee,
  listItemsOfCategory,
  updateItemOwnedByCoffee,
} from "../../repositories/admin/item.repository.js";
import { detachItemFromOffers } from "../../repositories/offer.repository.js";
import { attachImageToEntity, deleteImage, resolveImageForEntity, resolveMediaForEntity } from "../image.service.js";
import type {
  AdminCategoryDto,
  AdminCoffeeDto,
  AdminItemDto,
  AdminContext,
  CoffeeUpdateInput,
  ItemMediaDto,
} from "../../types/index.js";
import { ApiError } from "../../utils/ApiError.js";

/**
 * Coffee-admin operations. Everything is scoped to the single coffee bound to
 * the authenticated token (`coffeeId`). No `coffeeId`, `categoryId` or
 * `itemId` coming from the frontend is ever trusted on its own — ownership is
 * re-validated against the stored relationships for every operation.
 */

export interface ItemMediaInput {
  url: string;
  alt?: string | null;
}

export interface CreateItemInput {
  name: string;
  description?: string;
  price: number;
  promotion?: number | null;
  isAvailable?: boolean;
  image?: string;
  media?: ItemMediaInput[];
}

export interface UpdateItemInput {
  name?: string;
  description?: string;
  price?: number;
  promotion?: number | null;
  isAvailable?: boolean;
  image?: string;
  media?: ItemMediaInput[];
  /** Cloudflare image id resolved from `image`; never accepted from the client. */
  imageId?: string | null;
}

type ItemPatch = Partial<{
  name: string;
  description: string;
  price: number;
  promotion: number | null;
  isAvailable: boolean;
  image: string | null;
  imageId: string | null;
  media: ItemMediaDto[];
}>;

function validateItemPricing(price: number, promotion: number | null): void {
  if (price <= 0 || (promotion !== null && (promotion <= 0 || promotion >= price))) {
    throw new ApiError(400, "Promotional price must be greater than zero and lower than the regular price.");
  }
}

function coverOf(media: ItemMediaDto[]): ItemMediaDto | null {
  return media.find((entry) => entry.type === "image") ?? null;
}

function imageIdsOfItem(item: { imageId: string | null; media: ItemMediaDto[] }): string[] {
  const ids = new Set<string>();
  if (item.imageId) ids.add(item.imageId);
  for (const media of item.media) {
    if (media.imageId) ids.add(media.imageId);
  }
  return [...ids];
}

async function resolveItemMedia(media: ItemMediaInput[], admin: AdminContext): Promise<ItemMediaDto[]> {
  const resolved: ItemMediaDto[] = [];
  for (const entry of media) {
    resolved.push(await resolveMediaForEntity({ url: entry.url, alt: entry.alt ?? null, admin }));
  }
  return resolved;
}

async function resolveLegacyImageMedia(image: string, admin: AdminContext): Promise<ItemMediaDto[]> {
  const resolved = await resolveImageForEntity({ url: image, admin });
  if (!resolved.url) return [];
  return [
    {
      imageId: resolved.imageId,
      url: resolved.url,
      type: "image",
      mimeType: null,
      durationMs: null,
      alt: null,
    },
  ];
}

function coffeeToDto(coffee: {
  id: string;
  name: string;
  logo: string;
  cover: string | null;
  slug: string;
  tableCount: number | null;
  categoryCount: number;
  createdAt: Date;
  updatedAt: Date;
}): AdminCoffeeDto {
  return coffee;
}

function categoryToDto(category: {
  _id: import("mongoose").Types.ObjectId;
  name: string;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
}): AdminCategoryDto {
  return {
    id: category._id.toString(),
    name: category.name,
    image: category.image,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    itemCount: category.itemCount,
  };
}

function itemToDto(item: {
  _id: import("mongoose").Types.ObjectId;
  name: string;
  description: string | null;
  price: number;
  promotion: number | null;
  isAvailable: boolean;
  image: string | null;
  media: ItemMediaDto[];
  itemCategoryId: import("mongoose").Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}): AdminItemDto {
  return {
    id: item._id.toString(),
    name: item.name,
    description: item.description,
    price: item.price,
    promotion: item.promotion ?? null,
    isAvailable: item.isAvailable ?? true,
    image: item.image,
    media: item.media,
    itemCategoryId: item.itemCategoryId.toString(),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}

export async function getMyCoffee(coffeeId: string): Promise<AdminCoffeeDto> {
  const coffee = await findAdminCoffeeById(coffeeId);
  if (!coffee) throw new ApiError(404, "Coffee not found");
  return coffeeToDto({
    id: coffee._id.toString(),
    name: coffee.name,
    logo: coffee.logo,
    cover: coffee.cover,
    slug: coffee.slug,
    tableCount: coffee.tableCount,
    categoryCount: coffee.categoryCount,
    createdAt: coffee.createdAt,
    updatedAt: coffee.updatedAt,
  });
}

export async function updateMyCoffee(coffeeId: string, input: CoffeeUpdateInput): Promise<AdminCoffeeDto> {
  const existing = await findAdminCoffeeById(coffeeId);
  if (!existing) throw new ApiError(404, "Coffee not found");

  // The slug is the coffee's public identity (QR links point at it), so a
  // coffee admin can never change it — only the app admin can.
  if (input.slug !== undefined && input.slug !== existing.slug) {
    throw new ApiError(400, "The coffee slug cannot be changed.");
  }

  const admin: AdminContext = { role: "COFFEE_ADMIN", coffeeId };
  const patch: Partial<{
    name: string;
    logo: string;
    logoImageId: string | null;
    cover: string | null;
    coverImageId: string | null;
    tableCount: number | null;
  }> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.logo !== undefined) {
    const resolved = await resolveImageForEntity({ url: input.logo, admin });
    patch.logo = resolved.url;
    patch.logoImageId = resolved.imageId;
  }
  if (input.cover !== undefined) {
    const resolved = await resolveImageForEntity({ url: input.cover, admin });
    patch.cover = resolved.url;
    patch.coverImageId = resolved.imageId;
  }
  if (input.tableCount !== undefined) patch.tableCount = input.tableCount;

  const updated = await updateAdminCoffee(coffeeId, patch);
  if (!updated) throw new ApiError(404, "Coffee not found");

  if (patch.logoImageId) await attachImageToEntity(patch.logoImageId, coffeeId);
  if (patch.logoImageId !== undefined && existing.logoImageId !== null && existing.logoImageId !== patch.logoImageId) {
    await deleteImage(existing.logoImageId, { coffeeId });
  }
  if (patch.coverImageId) await attachImageToEntity(patch.coverImageId, coffeeId);
  if (
    patch.coverImageId !== undefined &&
    existing.coverImageId !== null &&
    existing.coverImageId !== patch.coverImageId
  ) {
    await deleteImage(existing.coverImageId, { coffeeId });
  }

  return coffeeToDto({
    id: updated._id.toString(),
    name: updated.name,
    logo: updated.logo,
    cover: updated.cover,
    slug: updated.slug,
    tableCount: updated.tableCount,
    categoryCount: updated.categoryCount,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
}

export async function changeMyPin(coffeeId: string, currentPin: string, newPin: string): Promise<{ id: string }> {
  const coffee = await findCoffeeWithPinHashById(coffeeId);
  if (!coffee) throw new ApiError(404, "Coffee not found");

  const valid =
    coffee.adminPinHash !== undefined &&
    coffee.adminPinHash !== null &&
    (await verifyPin(currentPin, coffee.adminPinHash));
  if (!valid) throw new ApiError(401, "Invalid current PIN");

  const adminPinHash = await hashPin(newPin);
  await updateCoffeePinHash(coffeeId, adminPinHash);
  return { id: coffeeId };
}

// ---- Categories -----------------------------------------------------------

export async function listCategories(coffeeId: string): Promise<AdminCategoryDto[]> {
  const categories = await listCategoriesOfCoffee(coffeeId);
  return categories.map(categoryToDto);
}

export async function createCategory(coffeeId: string, name: string, image?: string): Promise<AdminCategoryDto> {
  try {
    const admin: AdminContext = { role: "COFFEE_ADMIN", coffeeId };
    const resolved = image ? await resolveImageForEntity({ url: image, admin }) : { url: null, imageId: null };
    const category = await createCategoryForCoffee(coffeeId, name, resolved.url, resolved.imageId);
    if (resolved.imageId) await attachImageToEntity(resolved.imageId, coffeeId);
    return categoryToDto(category);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ApiError(409, "A category with this name already exists for this coffee");
    }
    throw error;
  }
}

export async function updateCategory(
  coffeeId: string,
  categoryId: string,
  name: string,
  image?: string,
): Promise<AdminCategoryDto> {
  try {
    const existing = await findCategoryOwnedByCoffee(coffeeId, categoryId);
    if (!existing) throw new ApiError(404, "Category not found");
    const admin: AdminContext = { role: "COFFEE_ADMIN", coffeeId };
    const resolved = image ? await resolveImageForEntity({ url: image, admin }) : { url: null, imageId: null };
    const category = await updateCategoryOwnedByCoffee(coffeeId, categoryId, name, resolved.url, resolved.imageId);
    if (!category) throw new ApiError(404, "Category not found");
    if (resolved.imageId) await attachImageToEntity(resolved.imageId, coffeeId);
    if (existing.imageId && existing.imageId !== resolved.imageId) {
      await deleteImage(existing.imageId, { coffeeId });
    }
    return categoryToDto(category);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ApiError(409, "A category with this name already exists for this coffee");
    }
    throw error;
  }
}

/** Deletes the category and its items (dependency-order, no orphans). */
export async function deleteCategory(coffeeId: string, categoryId: string): Promise<{ id: string }> {
  const category = await findCategoryOwnedByCoffee(coffeeId, categoryId);
  if (!category) throw new ApiError(404, "Category not found");

  const items = await listItemsOfCategory(categoryId);
  const deleted = await deleteCategoryOwnedByCoffee(coffeeId, categoryId);
  if (!deleted) throw new ApiError(404, "Category not found");

  const imageIds = new Set<string>();
  for (const item of items) {
    for (const imageId of imageIdsOfItem(item)) imageIds.add(imageId);
  }
  if (category.imageId) {
    imageIds.add(category.imageId);
  }
  for (const imageId of imageIds) {
    await deleteImage(imageId, { coffeeId, categoryId });
  }

  return { id: categoryId };
}

// ---- Items ----------------------------------------------------------------

export async function listItems(coffeeId: string, categoryId: string): Promise<AdminItemDto[]> {
  const category = await findCategoryOwnedByCoffee(coffeeId, categoryId);
  if (!category) throw new ApiError(404, "Category not found");

  const items = await listItemsOfCategory(categoryId);
  return items.map(itemToDto);
}

export async function createItem(coffeeId: string, categoryId: string, input: CreateItemInput): Promise<AdminItemDto> {
  const category = await findCategoryOwnedByCoffee(coffeeId, categoryId);
  if (!category) throw new ApiError(404, "Category not found");
  validateItemPricing(input.price, input.promotion ?? null);

  const admin: AdminContext = { role: "COFFEE_ADMIN", coffeeId };
  const media =
    input.media !== undefined
      ? await resolveItemMedia(input.media, admin)
      : input.image !== undefined
        ? await resolveLegacyImageMedia(input.image, admin)
        : [];
  const cover = coverOf(media);

  const item = await createItemForCategory(categoryId, {
    name: input.name,
    description: input.description ?? null,
    price: input.price,
    promotion: input.promotion ?? null,
    isAvailable: input.isAvailable ?? true,
    image: cover?.url ?? null,
    imageId: cover?.imageId ?? null,
    media,
  });

  for (const imageId of imageIdsOfItem(item)) {
    await attachImageToEntity(imageId, coffeeId);
  }
  return itemToDto(item);
}

export async function updateItem(coffeeId: string, itemId: string, input: UpdateItemInput): Promise<AdminItemDto> {
  const existing = await findItemOwnedByCoffee(coffeeId, itemId);
  if (!existing) throw new ApiError(404, "Item not found");
  validateItemPricing(
    input.price ?? existing.price,
    input.promotion !== undefined ? input.promotion : existing.promotion,
  );

  const admin: AdminContext = { role: "COFFEE_ADMIN", coffeeId };
  const patch: ItemPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.price !== undefined) patch.price = input.price;
  if (input.promotion !== undefined) patch.promotion = input.promotion;
  if (input.isAvailable !== undefined) patch.isAvailable = input.isAvailable;

  let nextMedia: ItemMediaDto[] | undefined;
  if (input.media !== undefined) {
    nextMedia = await resolveItemMedia(input.media, admin);
    const cover = coverOf(nextMedia);
    patch.media = nextMedia;
    patch.image = cover?.url ?? null;
    patch.imageId = cover?.imageId ?? null;
  } else if (input.image !== undefined) {
    nextMedia = await resolveLegacyImageMedia(input.image, admin);
    const cover = coverOf(nextMedia);
    patch.media = nextMedia;
    patch.image = cover?.url ?? null;
    patch.imageId = cover?.imageId ?? null;
  }

  const item = await updateItemOwnedByCoffee(coffeeId, itemId, patch);
  if (!item) throw new ApiError(404, "Item not found");

  if (nextMedia !== undefined) {
    const previousIds = new Set(imageIdsOfItem(existing));
    const currentIds = new Set(imageIdsOfItem(item));
    for (const imageId of currentIds) {
      await attachImageToEntity(imageId, coffeeId);
    }
    for (const imageId of previousIds) {
      if (!currentIds.has(imageId)) await deleteImage(imageId, { coffeeId, itemId });
    }
  }

  return itemToDto(item);
}

export async function deleteItem(coffeeId: string, itemId: string): Promise<{ id: string }> {
  const existing = await findItemOwnedByCoffee(coffeeId, itemId);
  if (!existing) throw new ApiError(404, "Item not found");

  const deleted = await deleteItemOwnedByCoffee(coffeeId, itemId);
  if (!deleted) throw new ApiError(404, "Item not found");

  // An offer must never keep pointing at an item that no longer exists.
  await detachItemFromOffers(coffeeId, itemId);

  for (const imageId of imageIdsOfItem(existing)) {
    await deleteImage(imageId, { coffeeId, itemId });
  }
  return { id: itemId };
}
