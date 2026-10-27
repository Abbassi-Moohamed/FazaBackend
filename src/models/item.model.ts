import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const itemMediaSchema = new Schema(
  {
    /** Cloudflare R2 object key; null for external image URLs. */
    imageId: {
      type: String,
      trim: true,
      default: null,
    },
    url: {
      type: String,
      required: [true, "Media URL is required."],
      trim: true,
    },
    type: {
      type: String,
      enum: ["image", "video"],
      required: [true, "Media type is required."],
    },
    mimeType: {
      type: String,
      trim: true,
      default: null,
    },
    /** Container duration for videos; null for images and GIFs. */
    durationMs: {
      type: Number,
      min: 0,
      default: null,
    },
    alt: {
      type: String,
      trim: true,
      maxlength: [300, "Media alt text must be at most 300 characters."],
      default: null,
    },
  },
  { _id: false },
);

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
    /**
     * Ordered media gallery (cover first). Bounded to five entries: this is a
     * menu card, not a media library, and an unbounded embedded array would
     * grow the hot item document indefinitely.
     */
    media: {
      type: [itemMediaSchema],
      default: [],
      validate: {
        validator: (media: unknown[]) => media.length <= 5,
        message: "An item can have at most 5 media files.",
      },
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
itemSchema.index({ "media.imageId": 1 });

export type Item = InferSchemaType<typeof itemSchema> & {
  _id: Types.ObjectId;
};

export const ItemModel = model<Item>("Item", itemSchema);
