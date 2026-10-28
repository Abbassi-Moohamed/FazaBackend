import { migrations } from "./index.js";

/**
 * 0015_item_views
 *
 * Stores daily aggregate counts for public menu item detail views. No visitor
 * identifiers or request metadata are retained.
 */
migrations.push({
  name: "0015_item_views",

  async up({ db }) {
    try {
      await db.createCollection("itemviews", {
        validator: {
          $jsonSchema: {
            bsonType: "object",
            required: ["coffeeId", "itemId", "viewDate", "views"],
            properties: {
              _id: {},
              coffeeId: { bsonType: "objectId" },
              itemId: { bsonType: "objectId" },
              viewDate: { bsonType: "date" },
              views: { bsonType: ["int", "long", "double"], minimum: 1 },
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
      .collection("itemviews")
      .createIndex({ coffeeId: 1, itemId: 1, viewDate: 1 }, { name: "idx_itemviews_coffee_item_date", unique: true });
    await db.collection("itemviews").createIndex({ coffeeId: 1, viewDate: 1 }, { name: "idx_itemviews_coffee_date" });
    await db
      .collection("itemviews")
      .createIndex({ viewDate: 1 }, { name: "idx_itemviews_retention", expireAfterSeconds: 400 * 24 * 60 * 60 });
  },

  async down({ db }) {
    // DESTRUCTIVE: drops the aggregate view counts.
    const collections = await db.listCollections({ name: "itemviews" }).toArray();
    if (collections.length > 0) await db.dropCollection("itemviews");
  },
});
