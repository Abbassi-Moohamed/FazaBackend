import { Types } from "mongoose";
import { CoffeeModel } from "../models/coffee.model.js";
import { ImageModel } from "../models/image.model.js";
import { ItemCategoryModel } from "../models/item-category.model.js";
import { ItemModel } from "../models/item.model.js";
import { OfferModel } from "../models/offer.model.js";
import type { AdminContext, AdminImageDto } from "../types/index.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";
import {
  assertSupportedImage,
  deleteCloudflareImage,
  isManagedDeliveryUrl,
  parseImageIdFromDeliveryUrl,
  sanitizeFilename,
  uploadCloudflareImage,
} from "./cloudflare-images.service.js";

/**
 * Application-level image service. Wraps the Cloudflare R2 client with
 * ownership, metadata and lifecycle rules:
 *
 *  - uploads validate the file (type/size), store the image in Cloudflare and
 *    record only metadata (`imageId`, `url`, …) in MongoDB;
 *  - deletion is ownership-checked — a coffee admin can only remove images
 *    attached to their own coffee;
 *  - entity replacement never removes the old image before the new one is
 *    saved.
 *
 * Reference bookkeeping (which coffee/item still uses an image) is done here
 * with direct model queries because it spans multiple collections.
 */

function assertValidCoffeeId(coffeeId: string): void {
  if (!Types.ObjectId.isValid(coffeeId)) throw new ApiError(400, "Invalid coffee identifier");
}

/** Uploads a validated image to Cloudflare and records its metadata. */
export async function uploadAdminImage(input: {
  buffer: Buffer;
  contentType: string;
  originalName: string;
  admin: AdminContext;
}): Promise<AdminImageDto> {
  assertSupportedImage({ buffer: input.buffer, contentType: input.contentType, originalname: input.originalName });

  const uploaded = await uploadCloudflareImage({
    buffer: input.buffer,
    contentType: input.contentType,
    filename: sanitizeFilename(input.originalName),
  });

  const isCoffeeAdmin = input.admin.role === "COFFEE_ADMIN";
  const doc = await ImageModel.create({
    imageId: uploaded.imageId,
    url: uploaded.url,
    filename: sanitizeFilename(input.originalName) || null,
    ownerType: isCoffeeAdmin ? "COFFEE" : "APP",
    coffeeId: isCoffeeAdmin && input.admin.coffeeId ? new Types.ObjectId(input.admin.coffeeId) : null,
    uploadedByRole: input.admin.role,
  });

  return { imageId: doc.imageId, url: doc.url };
}

/**
 * Resolves an entity image URL to its Cloudflare image id when the URL is a
 * delivery URL we track. External URLs (e.g. `picsum.photos`) keep `imageId`
 * null and are stored unchanged — backward compatible with existing data.
 *
 * A coffee admin may only attach images that are unclaimed (`APP` owned) or
 * already owned by their own coffee — never another coffee's image.
 */
export async function resolveImageForEntity(input: {
  url: string;
  admin: AdminContext;
}): Promise<{ imageId: string | null; url: string }> {
  if (!isManagedDeliveryUrl(input.url)) return { imageId: null, url: input.url };

  const imageId = parseImageIdFromDeliveryUrl(input.url);
  if (!imageId) return { imageId: null, url: input.url };

  const doc = await ImageModel.findOne({ imageId }).lean().exec();
  if (!doc) return { imageId: null, url: input.url };

  if (input.admin.role === "COFFEE_ADMIN") {
    const ownedBySelf = doc.ownerType === "COFFEE" && doc.coffeeId?.toString() === input.admin.coffeeId;
    const unclaimed = doc.ownerType === "APP";
    if (!ownedBySelf && !unclaimed) {
      throw new ApiError(403, "Forbidden");
    }
  }

  return { imageId, url: input.url };
}

/**
 * Marks a tracked image as owned by a coffee once it is attached to one of
 * that coffee's entities. Metadata-only and best-effort: a failure here is
 * logged, never fatal to the entity write.
 */
export async function attachImageToEntity(imageId: string | null, coffeeId: string): Promise<void> {
  if (!imageId || coffeeId.length === 0) return;
  assertValidCoffeeId(coffeeId);
  try {
    await ImageModel.updateOne({ imageId }, { $set: { ownerType: "COFFEE", coffeeId: new Types.ObjectId(coffeeId) } });
  } catch (error) {
    logger.warn({ err: error, imageId, coffeeId }, "Failed to mark image as owned by its coffee");
  }
}

/** True when another entity (or the same one in `exclude`) still references the image. */
async function isImageStillReferenced(
  imageId: string,
  exclude?: { coffeeId?: string; itemId?: string; categoryId?: string; offerId?: string },
): Promise<boolean> {
  const items = await ItemModel.find({ imageId }).select({ _id: 1 }).lean().exec();
  for (const item of items) {
    if (item._id.toString() !== exclude?.itemId) return true;
  }

  const coffees = await CoffeeModel.find({ logoImageId: imageId }).select({ _id: 1 }).lean().exec();
  for (const coffee of coffees) {
    if (coffee._id.toString() !== exclude?.coffeeId) return true;
  }
  const coverCoffees = await CoffeeModel.find({ coverImageId: imageId }).select({ _id: 1 }).lean().exec();
  for (const coffee of coverCoffees) {
    if (coffee._id.toString() !== exclude?.coffeeId) return true;
  }

  const categories = await ItemCategoryModel.find({ imageId }).select({ _id: 1 }).lean().exec();
  for (const category of categories) {
    if (category._id.toString() !== exclude?.categoryId) return true;
  }

  const offers = await OfferModel.find({ imageId }).select({ _id: 1 }).lean().exec();
  for (const offer of offers) {
    if (offer._id.toString() !== exclude?.offerId) return true;
  }

  return false;
}

/**
 * True when the given coffee owns the image, directly (metadata) or because
 * the image is attached to one of its own entities.
 */
async function isImageUsedByCoffee(imageId: string, coffeeId: string): Promise<boolean> {
  const coffee = await CoffeeModel.exists({ _id: coffeeId, logoImageId: imageId });
  if (coffee) return true;
  const cover = await CoffeeModel.exists({ _id: coffeeId, coverImageId: imageId });
  if (cover) return true;

  const categories = await ItemCategoryModel.exists({ imageId, coffeeId });
  if (categories) return true;

  const offer = await OfferModel.exists({ imageId, coffeeId });
  if (offer) return true;

  const items = await ItemModel.find({ imageId }).select({ itemCategoryId: 1 }).lean().exec();
  if (items.length === 0) return false;
  const categoryIds = items.map((item) => item.itemCategoryId);
  const category = await ItemCategoryModel.exists({ _id: { $in: categoryIds }, coffeeId });
  return category !== null;
}

async function assertCanManageImage(imageId: string, admin: AdminContext): Promise<void> {
  const doc = await ImageModel.findOne({ imageId }).lean().exec();
  if (!doc) throw new ApiError(404, "Image not found");

  if (admin.role === "APP_ADMIN") return;

  const coffeeId = admin.coffeeId;
  if (!coffeeId) throw new ApiError(403, "Forbidden");

  const ownsDirectly = doc.ownerType === "COFFEE" && doc.coffeeId?.toString() === coffeeId;
  if (ownsDirectly || (await isImageUsedByCoffee(imageId, coffeeId))) return;

  throw new ApiError(403, "Forbidden");
}

/**
 * Deletes the Cloudflare image (when it is no longer referenced) and removes
 * its metadata. Cloudflare failures are logged, not thrown: the MongoDB state
 * must never keep pointing at an image ScanMenu has decided to remove.
 */
export async function deleteImage(
  imageId: string,
  exclude?: { coffeeId?: string; itemId?: string; categoryId?: string; offerId?: string },
): Promise<void> {
  if (!imageId) return;
  if (await isImageStillReferenced(imageId, exclude)) return;

  try {
    await deleteCloudflareImage(imageId);
  } catch (error) {
    logger.error(
      { err: error, imageId },
      "Cloudflare image deletion failed; removing local reference to avoid an inconsistent state",
    );
  }

  await ImageModel.deleteOne({ imageId });
}

/** Ownership-checked deletion for the admin endpoint. */
export async function deleteAdminImage(imageId: string, admin: AdminContext): Promise<{ id: string }> {
  await assertCanManageImage(imageId, admin);
  await deleteImage(imageId);
  return { id: imageId };
}
