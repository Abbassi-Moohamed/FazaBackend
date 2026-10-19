import { model, Schema, type InferSchemaType, type Types } from "mongoose";

/**
 * Metadata for images stored in Cloudflare R2. Only the R2 object key
 * identifier and its delivery URL are stored — never the image binary.
 *
 * `ownerType`/`coffeeId` drive the delete authorization: an image owned by a
 * coffee can only be removed by that coffee's admin (or the app admin);
 * images uploaded by the app admin and not yet attached to a coffee are `APP`
 * owned until they are claimed by a coffee.
 */
const imageSchema = new Schema(
  {
    /** The R2 object key (unique). */
    imageId: {
      type: String,
      required: [true, "R2 object key is required."],
      unique: true,
      trim: true,
      maxlength: [200, "imageId must be at most 200 characters."],
    },
    /** The public delivery URL served by the configured R2 domain. */
    url: {
      type: String,
      required: [true, "Image delivery URL is required."],
      trim: true,
    },
    /** Sanitized original filename (never trusted as a path). */
    filename: {
      type: String,
      trim: true,
      default: null,
      maxlength: [200, "filename must be at most 200 characters."],
    },
    alt: {
      type: String,
      trim: true,
      default: null,
      maxlength: [300, "alt must be at most 300 characters."],
    },
    /** Who can manage the image: the owning coffee, or the app level. */
    ownerType: {
      type: String,
      enum: ["COFFEE", "APP"],
      required: [true, "Image ownership is required."],
    },
    /** The owning coffee (for COFFEE-owned images). */
    coffeeId: {
      type: Schema.Types.ObjectId,
      ref: "Coffee",
      default: null,
    },
    /** Role of the admin account that uploaded the image. */
    uploadedByRole: {
      type: String,
      enum: ["APP_ADMIN", "COFFEE_ADMIN"],
      required: [true, "Uploading role is required."],
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "images",
  },
);

imageSchema.index({ imageId: 1 }, { unique: true });
imageSchema.index({ coffeeId: 1 });

export type Image = InferSchemaType<typeof imageSchema> & {
  _id: Types.ObjectId;
};

export const ImageModel = model<Image>("Image", imageSchema);
