import { Types } from "mongoose";
import { hashPin } from "../../auth/pin.js";
import {
  createAdminCoffee,
  deleteCoffeeWithDependencies,
  findAdminCoffeeById,
  isCoffeeSlugTaken,
  listAdminCoffees,
  updateAdminCoffee,
  updateCoffeePinHash,
} from "../../repositories/admin/coffee.repository.js";
import { listItemImageIdsOfCoffee } from "../../repositories/admin/item.repository.js";
import { listCategoryImageIdsOfCoffee } from "../../repositories/admin/category.repository.js";
import { listOfferImageIdsOfCoffee } from "../../repositories/offer.repository.js";
import { attachImageToEntity, deleteImage, resolveImageForEntity } from "../image.service.js";
import type { AdminCoffeeDto, AdminContext, CoffeeUpdateInput } from "../../types/index.js";
import { ApiError } from "../../utils/ApiError.js";

/**
 * Application-admin coffee management. The app admin can act on every coffee.
 */

const DEFAULT_COFFEE_PIN = "0000";

export interface CreateCoffeeInput {
  name: string;
  logo: string;
  cover?: string;
  slug?: string;
}

function toDto(coffee: {
  _id: Types.ObjectId;
  name: string;
  logo: string;
  cover: string | null;
  slug: string;
  categoryCount: number;
  createdAt: Date;
  updatedAt: Date;
}): AdminCoffeeDto {
  return {
    id: coffee._id.toString(),
    name: coffee.name,
    logo: coffee.logo,
    cover: coffee.cover,
    slug: coffee.slug,
    categoryCount: coffee.categoryCount,
    createdAt: coffee.createdAt,
    updatedAt: coffee.updatedAt,
  };
}

/** Lowercase `name`, strip accents and non-alphanumerics, join with dashes. */
function slugify(name: string): string {
  const base = name
    .normalize("NFKD") // Café → Cafe
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return base.length > 0 ? base : "coffee";
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (await isCoffeeSlugTaken(slug)) {
    const candidate = `${base}-${suffix}`;
    slug = candidate.slice(0, 80).replace(/-+$/g, "");
    suffix += 1;
  }
  return slug;
}

async function assertSlugAvailable(slug: string, excludeId?: string): Promise<void> {
  if (await isCoffeeSlugTaken(slug, excludeId)) {
    throw new ApiError(409, "Slug is already taken");
  }
}

export async function listCoffees(): Promise<AdminCoffeeDto[]> {
  const coffees = await listAdminCoffees();
  return coffees.map(toDto);
}

export async function getCoffee(coffeeId: string): Promise<AdminCoffeeDto> {
  const coffee = await findAdminCoffeeById(coffeeId);
  if (!coffee) throw new ApiError(404, "Coffee not found");
  return toDto(coffee);
}

export async function createCoffee(input: CreateCoffeeInput): Promise<AdminCoffeeDto> {
  const slug = input.slug ?? (await generateUniqueSlug(input.name));
  await assertSlugAvailable(slug);

  const admin: AdminContext = { role: "APP_ADMIN" };
  const resolved = await resolveImageForEntity({ url: input.logo, admin });
  const resolvedCover = input.cover
    ? await resolveImageForEntity({ url: input.cover, admin })
    : { url: null, imageId: null };

  const adminPinHash = await hashPin(DEFAULT_COFFEE_PIN);
  const coffee = await createAdminCoffee({
    name: input.name,
    logo: resolved.url,
    logoImageId: resolved.imageId,
    cover: resolvedCover.url,
    coverImageId: resolvedCover.imageId,
    slug,
    adminPinHash,
  });

  await attachImageToEntity(resolved.imageId, coffee._id.toString());
  await attachImageToEntity(resolvedCover.imageId, coffee._id.toString());
  return toDto(coffee);
}

export async function updateCoffee(coffeeId: string, input: CoffeeUpdateInput): Promise<AdminCoffeeDto> {
  const existing = await findAdminCoffeeById(coffeeId);
  if (!existing) throw new ApiError(404, "Coffee not found");

  if (input.slug !== undefined) {
    await assertSlugAvailable(input.slug, coffeeId);
  }

  const admin: AdminContext = { role: "APP_ADMIN" };
  const patch: Partial<{
    name: string;
    logo: string;
    slug: string;
    logoImageId: string | null;
    cover: string | null;
    coverImageId: string | null;
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
  if (input.slug !== undefined) patch.slug = input.slug;

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

  return toDto(updated);
}

/** Deletes the coffee and cascades categories → items (no orphans). */
export async function deleteCoffee(coffeeId: string): Promise<{ id: string }> {
  const existing = await findAdminCoffeeById(coffeeId);
  if (!existing) throw new ApiError(404, "Coffee not found");

  const itemImageIds = await listItemImageIdsOfCoffee(coffeeId);
  const categoryImageIds = await listCategoryImageIdsOfCoffee(coffeeId);
  const offerImageIds = await listOfferImageIdsOfCoffee(coffeeId);

  const deleted = await deleteCoffeeWithDependencies(coffeeId);
  if (!deleted) throw new ApiError(404, "Coffee not found");

  const allImageIds = [
    ...(existing.logoImageId ? [existing.logoImageId] : []),
    ...itemImageIds,
    ...categoryImageIds,
    ...offerImageIds,
  ];
  for (const imageId of new Set(allImageIds)) {
    await deleteImage(imageId, { coffeeId });
  }

  return { id: coffeeId };
}

/** Resets a coffee's admin PIN to the default `0000`, stored hashed. */
export async function resetCoffeePin(coffeeId: string): Promise<{ id: string }> {
  const existing = await findAdminCoffeeById(coffeeId);
  if (!existing) throw new ApiError(404, "Coffee not found");

  const adminPinHash = await hashPin(DEFAULT_COFFEE_PIN);
  await updateCoffeePinHash(coffeeId, adminPinHash);
  return { id: coffeeId };
}
