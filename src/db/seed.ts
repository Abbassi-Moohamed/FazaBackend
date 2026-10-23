import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { env } from "../config/env.js";
import { connectDatabase, disconnectDatabase } from "./index.js";
import { CoffeeModel } from "../models/coffee.model.js";
import { ItemCategoryModel } from "../models/item-category.model.js";
import { ItemModel } from "../models/item.model.js";
import { OfferModel } from "../models/offer.model.js";
import { OrderModel } from "../models/order.model.js";
import { ServiceShiftModel } from "../models/service-shift.model.js";
import { TableSessionModel } from "../models/table-session.model.js";
import { hashPin } from "../auth/pin.js";
import { menuSeed } from "./seed-data.js";
import { logger } from "../utils/logger.js";

/** Default coffee admin PIN used by the seed and by coffee creation. */
const DEFAULT_ADMIN_PIN = "0000";

/**
 * Destructive developer seed: wipes orders, sessions, shifts, coffees,
 * categories and items, then
 * recreates the realistic multi-coffee dataset from seed-data.ts.
 *
 * Wipe order respects the document references (items → categories → coffees).
 * Runs on the already-connected database.
 */
export async function seedDatabase(): Promise<{ coffees: number; categories: number; items: number }> {
  await OrderModel.deleteMany({});
  await TableSessionModel.deleteMany({});
  await ServiceShiftModel.deleteMany({});
  await OfferModel.deleteMany({});
  await ItemModel.deleteMany({});
  await ItemCategoryModel.deleteMany({});
  await CoffeeModel.deleteMany({});

  let categories = 0;
  let items = 0;

  // Every seeded coffee uses the default admin PIN 0000, stored hashed.
  const defaultAdminPinHash = await hashPin(DEFAULT_ADMIN_PIN);

  for (const coffeeSeed of menuSeed) {
    const coffee = await CoffeeModel.create({
      name: coffeeSeed.name,
      slug: coffeeSeed.slug,
      logo: coffeeSeed.logo,
      adminPinHash: defaultAdminPinHash,
    });

    for (const categorySeed of coffeeSeed.categories) {
      const category = await ItemCategoryModel.create({
        name: categorySeed.name,
        coffeeId: coffee._id,
      });
      categories += 1;

      if (categorySeed.items.length > 0) {
        await ItemModel.insertMany(
          categorySeed.items.map((item) => ({
            name: item.name,
            description: item.description,
            price: item.price,
            image: item.image,
            itemCategoryId: category._id,
          })),
        );
        items += categorySeed.items.length;
      }
    }
  }

  return { coffees: menuSeed.length, categories, items };
}

async function main(): Promise<void> {
  await connectDatabase(env.DATABASE_URL);
  const result = await seedDatabase();
  logger.info(result, "Database seed complete");
  await disconnectDatabase();
}

const isDirectRun = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((error: unknown) => {
    logger.error(error, "Seed run failed");
    process.exitCode = 1;
  });
}
