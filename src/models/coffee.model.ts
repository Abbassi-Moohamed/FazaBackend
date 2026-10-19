import { model, Schema, type InferSchemaType, type Types } from "mongoose";

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MESSAGE =
  "Slug must be lowercase, start and end with a letter or digit, and may only contain dashes between segments (e.g. cafe-el-manzah).";

const coffeeSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Coffee name is required."],
      trim: true,
      maxlength: [120, "Coffee name must be at most 120 characters."],
    },
    slug: {
      type: String,
      required: [true, "Coffee slug is required."],
      trim: true,
      lowercase: true,
      unique: true,
      maxlength: [80, "Coffee slug must be at most 80 characters."],
      match: [SLUG_PATTERN, SLUG_MESSAGE],
    },
    logo: {
      type: String,
      required: [true, "Coffee logo URL is required."],
      trim: true,
    },
    /**
     * Cloudflare R2 object key backing `logo`, when the logo is hosted on our
     * Cloudflare account. `null` for external URLs (kept for compatibility).
     * Never the binary itself.
     */
    logoImageId: {
      type: String,
      trim: true,
      default: null,
    },
    cover: {
      type: String,
      trim: true,
      default: null,
    },
    coverImageId: {
      type: String,
      trim: true,
      default: null,
    },
    /**
     * scrypt hash of the coffee's 4-digit admin PIN (`scrypt$<salt>$<key>`).
     * Never exposed through any API response; the plain PIN is only ever
     * known by the person who set it.
     */
    adminPinHash: {
      type: String,
      required: false,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "coffees",
  },
);

coffeeSchema.virtual("categories", {
  ref: "ItemCategory",
  localField: "_id",
  foreignField: "coffeeId",
});

export type Coffee = InferSchemaType<typeof coffeeSchema> & {
  _id: Types.ObjectId;
};

export const CoffeeModel = model<Coffee>("Coffee", coffeeSchema);
