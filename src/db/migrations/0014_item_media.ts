import { migrations } from "./index.js";

type ValidatorOptions = {
  validator?: { $jsonSchema?: { properties?: Record<string, unknown> } };
};

const MEDIA_ITEM_SCHEMA = {
  bsonType: "object",
  required: ["url", "type"],
  properties: {
    imageId: { bsonType: ["string", "null"] },
    url: { bsonType: "string" },
    type: { bsonType: "string", enum: ["image", "video"] },
    mimeType: { bsonType: ["string", "null"] },
    durationMs: { bsonType: ["int", "long", "double", "null"] },
    alt: { bsonType: ["string", "null"] },
  },
};

/**
 * 0014_item_media
 *
 * Adds the bounded item gallery (`media`, max five entries) and records media
 * metadata on uploaded assets. Existing single-image items are backfilled as a
 * one-entry gallery so the public API can always read one shape.
 */
migrations.push({
  name: "0014_item_media",

  async up({ db }) {
    const itemsOptions = (await db.collection("items").options()) as ValidatorOptions;
    const itemsSchema = itemsOptions?.validator?.$jsonSchema;
    if (itemsSchema) {
      await db.command({
        collMod: "items",
        validator: {
          $jsonSchema: {
            ...itemsSchema,
            properties: {
              ...itemsSchema.properties,
              media: {
                bsonType: "array",
                maxItems: 5,
                items: MEDIA_ITEM_SCHEMA,
              },
            },
          },
        },
        validationLevel: "strict",
      });
    }

    const imagesOptions = (await db.collection("images").options()) as ValidatorOptions;
    const imagesSchema = imagesOptions?.validator?.$jsonSchema;
    if (imagesSchema) {
      await db.command({
        collMod: "images",
        validator: {
          $jsonSchema: {
            ...imagesSchema,
            properties: {
              ...imagesSchema.properties,
              mediaType: { bsonType: "string", enum: ["image", "video"] },
              mimeType: { bsonType: ["string", "null"] },
              durationMs: { bsonType: ["int", "long", "double", "null"] },
              sizeBytes: { bsonType: ["int", "long", "double", "null"] },
            },
          },
        },
        validationLevel: "strict",
      });
    }

    const cursor = db.collection("items").find({ $or: [{ media: { $exists: false } }, { media: { $size: 0 } }] });
    for await (const item of cursor) {
      const image = typeof item.image === "string" && item.image.length > 0 ? item.image : null;
      await db.collection("items").updateOne(
        { _id: item._id },
        {
          $set: {
            media: image
              ? [
                  {
                    imageId: typeof item.imageId === "string" ? item.imageId : null,
                    url: image,
                    type: "image",
                    mimeType: null,
                    durationMs: null,
                    alt: null,
                  },
                ]
              : [],
          },
        },
      );
    }

    const imageCursor = db
      .collection("images")
      .find({ $or: [{ mediaType: { $exists: false } }, { mimeType: { $exists: false } }] });
    for await (const image of imageCursor) {
      const imageId = typeof image.imageId === "string" ? image.imageId : "";
      const extension = imageId.slice(imageId.lastIndexOf(".") + 1).toLowerCase();
      const mimeType =
        extension === "png"
          ? "image/png"
          : extension === "webp"
            ? "image/webp"
            : extension === "gif"
              ? "image/gif"
              : "image/jpeg";
      await db.collection("images").updateOne(
        { _id: image._id },
        {
          $set: {
            mediaType: "image",
            mimeType,
            durationMs: null,
            sizeBytes: null,
          },
        },
      );
    }

    await db
      .collection("items")
      .createIndex({ "media.imageId": 1 }, { name: "idx_items_media_image_id", sparse: true });
  },

  async down({ db }) {
    const itemsOptions = (await db.collection("items").options()) as ValidatorOptions;
    const itemsSchema = itemsOptions?.validator?.$jsonSchema;
    if (itemsSchema) {
      const properties = { ...itemsSchema.properties };
      delete properties.media;
      await db.command({
        collMod: "items",
        validator: { $jsonSchema: { ...itemsSchema, properties } },
        validationLevel: "strict",
      });
    }

    const imagesOptions = (await db.collection("images").options()) as ValidatorOptions;
    const imagesSchema = imagesOptions?.validator?.$jsonSchema;
    if (imagesSchema) {
      const properties = { ...imagesSchema.properties };
      delete properties.mediaType;
      delete properties.mimeType;
      delete properties.durationMs;
      delete properties.sizeBytes;
      await db.command({
        collMod: "images",
        validator: { $jsonSchema: { ...imagesSchema, properties } },
        validationLevel: "strict",
      });
    }

    // DESTRUCTIVE: removes the gallery and its metadata.
    await db.collection("items").updateMany({}, { $unset: { media: "" } });
    await db
      .collection("images")
      .updateMany({}, { $unset: { mediaType: "", mimeType: "", durationMs: "", sizeBytes: "" } });
    await db
      .collection("items")
      .dropIndex("idx_items_media_image_id")
      .catch(() => undefined);
  },
});
