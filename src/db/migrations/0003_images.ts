import { migrations } from "./index.js";

/**
 * 0003_images
 *
 * Cloudflare R2 integration:
 *
 *   - new `images` collection storing only image metadata (Cloudflare image
 *     object key, delivery URL, filename, ownership) — never the image binary;
 *   - extends the `coffees` and `items` validators with the nullable
 *     `logoImageId` / `imageId` fields that reference a Cloudflare image.
 */
migrations.push({
  name: "0003_images",

  async up({ db }) {
    await ensureCollection(db, "images", {
      bsonType: "object",
      required: ["imageId", "url", "ownerType", "uploadedByRole"],
      properties: {
        _id: {},
        imageId: { bsonType: "string" },
        url: { bsonType: "string" },
        filename: { bsonType: ["string", "null"] },
        alt: { bsonType: ["string", "null"] },
        ownerType: { bsonType: "string", enum: ["COFFEE", "APP"] },
        coffeeId: { bsonType: ["objectId", "null"] },
        uploadedByRole: { bsonType: "string", enum: ["APP_ADMIN", "COFFEE_ADMIN"] },
      },
    });

    await db.collection("images").createIndex({ imageId: 1 }, { unique: true, name: "uq_images_image_id" });
    await db.collection("images").createIndex({ coffeeId: 1 }, { name: "idx_images_coffee" });

    await addNullableStringField(db, "coffees", "logoImageId");
    await addNullableStringField(db, "items", "imageId");
  },

  async down({ db }) {
    const collections = await db.listCollections({ name: "images" }).toArray();
    if (collections.length > 0) {
      await db.dropCollection("images");
    }

    await removeNullableField(db, "coffees", "logoImageId");
    await removeNullableField(db, "items", "imageId");
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
    if (!isNamespaceExistsError(error)) throw error;
  }
}

function isNamespaceExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: number; message?: string };
  return record.code === 48 || /already exists/i.test(record.message ?? "");
}

type ValidatorShape = {
  validator?: { $jsonSchema?: { properties?: Record<string, unknown> } };
};

/** Adds an optional nullable string field to a collection's $jsonSchema validator. */
async function addNullableStringField(db: import("mongodb").Db, collection: string, field: string): Promise<void> {
  const options = (await db.collection(collection).options()) as ValidatorShape;
  const schema = options?.validator?.$jsonSchema;
  if (!schema) return;

  await db.command({
    collMod: collection,
    validator: {
      $jsonSchema: {
        ...schema,
        properties: { ...schema.properties, [field]: { bsonType: ["string", "null"] } },
      },
    },
    validationLevel: "strict",
  });
}

/** Removes a field from a collection's $jsonSchema validator. */
async function removeNullableField(db: import("mongodb").Db, collection: string, field: string): Promise<void> {
  const options = (await db.collection(collection).options()) as ValidatorShape;
  const schema = options?.validator?.$jsonSchema;
  if (!schema) return;

  const properties = { ...schema.properties };
  delete properties[field];

  await db.command({
    collMod: collection,
    validator: { $jsonSchema: { ...schema, properties } },
    validationLevel: "strict",
  });
}
