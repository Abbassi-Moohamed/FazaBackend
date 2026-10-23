import { migrations } from "./index.js";

/**
 * 0013_offers
 *
 * Creates the `offers` collection (daily bundles) with a MongoDB $jsonSchema
 * validator and the indexes that back the admin list and the public featured
 * query. The offer's component lines and stock are stored on the offer itself;
 * item prices are always read live, never copied.
 */
migrations.push({
  name: "0013_offers",

  async up({ db }) {
    try {
      await db.createCollection("offers", {
        validator: {
          $jsonSchema: {
            bsonType: "object",
            required: ["coffeeId", "name", "price", "lines", "stock"],
            properties: {
              _id: {},
              coffeeId: { bsonType: "objectId" },
              name: { bsonType: "string" },
              description: { bsonType: ["string", "null"] },
              price: { bsonType: ["double", "int", "long", "decimal"] },
              lines: {
                bsonType: "array",
                minItems: 1,
                items: {
                  bsonType: "object",
                  required: ["itemId", "quantity"],
                  properties: {
                    itemId: { bsonType: "objectId" },
                    quantity: { bsonType: ["int", "long", "double"] },
                  },
                },
              },
              stock: { bsonType: ["int", "long", "double"] },
              image: { bsonType: ["string", "null"] },
              imageId: { bsonType: ["string", "null"] },
              startAt: { bsonType: ["date", "null"] },
              endAt: { bsonType: ["date", "null"] },
              isActive: { bsonType: ["bool", "null"] },
              archivedAt: { bsonType: ["date", "null"] },
            },
          },
        },
        validationLevel: "strict",
        validationAction: "error",
      });
    } catch (error) {
      const record = error as { code?: number; message?: string };
      if (record.code !== 48 && !/already exists/i.test(record.message ?? "")) throw error;
    }

    await db
      .collection("offers")
      .createIndex({ coffeeId: 1, archivedAt: 1, isActive: 1 }, { name: "idx_offers_coffee_archived_active" });
    await db.collection("offers").createIndex({ coffeeId: 1, createdAt: -1 }, { name: "idx_offers_coffee_created" });
  },

  async down({ db }) {
    // DESTRUCTIVE: drops the collection and every offer.
    const collections = await db.listCollections({ name: "offers" }).toArray();
    if (collections.length > 0) {
      await db.dropCollection("offers");
    }
  },
});
