import { migrations } from "./index.js";

/**
 * 0002_admin
 *
 * Extends the `coffees` collection validator (collMod) to accept the new
 * `adminPinHash` field (scrypt hash of the coffee admin PIN, stored as a
 * nullable string). The field is optional so pre-existing documents remain
 * valid, and it is excluded from Mongoose projections so it never reaches
 * API responses.
 */
migrations.push({
  name: "0002_admin",

  async up({ db }) {
    const collection = db.collection("coffees");
    const options = (await collection.options()) as {
      validator?: { $jsonSchema?: { properties?: Record<string, unknown> } };
    };
    const schema = options?.validator?.$jsonSchema;
    if (!schema) return; // No validator managed → nothing to migrate.

    await db.command({
      collMod: "coffees",
      validator: {
        $jsonSchema: {
          ...schema,
          properties: {
            ...schema.properties,
            adminPinHash: { bsonType: ["string", "null"] },
          },
        },
      },
      validationLevel: "strict",
    });
  },

  async down({ db }) {
    const collection = db.collection("coffees");
    const options = (await collection.options()) as {
      validator?: { $jsonSchema?: { properties?: Record<string, unknown> } };
    };
    const schema = options?.validator?.$jsonSchema;
    if (!schema) return;

    const properties = { ...schema.properties };
    delete properties.adminPinHash;

    await db.command({
      collMod: "coffees",
      validator: { $jsonSchema: { ...schema, properties } },
      validationLevel: "strict",
    });
  },
});
