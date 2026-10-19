import { migrations } from "./index.js";

/**
 * 0001_init
 *
 * Creates the three collections with MongoDB $jsonSchema validators
 * (defense-in-depth on top of Mongoose validation) and the indexes that
 * back the public queries and uniqueness rules:
 *
 *   Coffee        -> slug is unique (resolves `/:coffeeSlug`)
 *   ItemCategory  -> (coffeeId, name) unique; coffeeId indexed
 *   Item          -> itemCategoryId indexed
 */
migrations.push({
  name: "0001_init",

  async up({ db }) {
    await ensureCollection(db, "coffees", {
      bsonType: "object",
      required: ["name", "slug", "logo"],
      properties: {
        _id: {},
        name: { bsonType: "string" },
        slug: { bsonType: "string" },
        logo: { bsonType: "string" },
      },
    });

    await ensureCollection(db, "itemcategories", {
      bsonType: "object",
      required: ["name", "coffeeId"],
      properties: {
        _id: {},
        name: { bsonType: "string" },
        coffeeId: { bsonType: "objectId" },
      },
    });

    await ensureCollection(db, "items", {
      bsonType: "object",
      required: ["name", "price", "itemCategoryId"],
      properties: {
        _id: {},
        name: { bsonType: "string" },
        price: { bsonType: ["double", "int", "long", "decimal"] },
        itemCategoryId: { bsonType: "objectId" },
        description: { bsonType: ["string", "null"] },
        image: { bsonType: ["string", "null"] },
      },
    });

    await db.collection("coffees").createIndex({ slug: 1 }, { unique: true, name: "uq_coffees_slug" });
    await db
      .collection("itemcategories")
      .createIndex({ coffeeId: 1, name: 1 }, { unique: true, name: "uq_itemcategories_coffee_name" });
    await db.collection("itemcategories").createIndex({ coffeeId: 1 }, { name: "idx_itemcategories_coffee" });
    await db.collection("items").createIndex({ itemCategoryId: 1 }, { name: "idx_items_category" });
  },

  async down({ db }) {
    // DESTRUCTIVE: drops the collections and all their data.
    for (const name of ["coffees", "itemcategories", "items"]) {
      const collections = await db.listCollections({ name }).toArray();
      if (collections.length > 0) {
        await db.dropCollection(name);
      }
    }
  },
});

async function ensureCollection(
  db: import("mongodb").Db,
  name: string,
  validator: import("mongodb").Document,
): Promise<void> {
  try {
    await db.createCollection(name, {
      validator: { $jsonSchema: validator },
      validationLevel: "strict",
      validationAction: "error",
    });
  } catch (error) {
    // Namespace already exists (e.g. re-run, or a dev-created collection).
    // Referential/type safety is still enforced by Mongoose + indexes.
    if (!isNamespaceExistsError(error)) throw error;
  }
}

function isNamespaceExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: number; message?: string };
  return record.code === 48 || /already exists/i.test(record.message ?? "");
}
