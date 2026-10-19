import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const itemSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Item name is required."],
      trim: true,
      maxlength: [120, "Item name must be at most 120 characters."],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Item description must be at most 500 characters."],
      default: null,
    },
    price: {
      type: Number,
      required: [true, "Item price is required."],
      min: [0.001, "Item price must be greater than zero."],
    },
    promotion: {
      type: Number,
      default: null,
      min: [0.001, "Promotional price must be greater than zero."],
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    image: {
      type: String,
      trim: true,
      default: null,
    },
    /**
     * Cloudflare R2 object key backing `image`, when the image is hosted on our
     * Cloudflare account. `null` for external URLs (kept for compatibility).
     * Never the binary itself.
     */
    imageId: {
      type: String,
      trim: true,
      default: null,
    },
    itemCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "ItemCategory",
      required: [true, "An item must belong to a category."],
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "items",
  },
);

itemSchema.index({ itemCategoryId: 1 });

export type Item = InferSchemaType<typeof itemSchema> & {
  _id: Types.ObjectId;
};

export const ItemModel = model<Item>("Item", itemSchema);
