import { model, Schema, type InferSchemaType, type Types } from "mongoose";

/**
 * Derived lifecycle of an offer. Never stored: it is computed from the flags
 * and the clock so the admin list always matches reality.
 */
export const OFFER_STATUSES = ["ACTIVE", "SCHEDULED", "EXPIRED", "SOLD_OUT", "PAUSED", "ARCHIVED"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/**
 * The components of a daily offer: menu items (and the quantity of each) that
 * the offer bundles. The offer references items by id and keeps no price copy:
 * the comparison price is always recomputed from the live menu, so a price
 * change on an item is reflected immediately.
 */
const offerLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    quantity: { type: Number, required: true, min: 1, max: 99 },
  },
  { _id: false },
);

const offerSchema = new Schema(
  {
    coffeeId: { type: Schema.Types.ObjectId, ref: "Coffee", required: true, index: true },
    name: {
      type: String,
      required: [true, "Offer name is required."],
      trim: true,
      maxlength: [120, "Offer name must be at most 120 characters."],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Offer description must be at most 500 characters."],
      default: null,
    },
    /** The bundle's selling price (decimal, TND). */
    price: {
      type: Number,
      required: [true, "Offer price is required."],
      min: [0.001, "Offer price must be greater than zero."],
    },
    lines: {
      type: [offerLineSchema],
      required: true,
      validate: [(value: unknown[]) => value.length > 0, "An offer must contain at least one item."],
    },
    /** Remaining number of bundles that can be sold. */
    stock: {
      type: Number,
      required: true,
      min: [0, "Offer stock cannot be negative."],
      max: [9999, "Offer stock must be at most 9999."],
      default: 0,
    },
    image: { type: String, trim: true, default: null },
    /** Cloudflare R2 object key backing `image`, `null` for external URLs. */
    imageId: { type: String, trim: true, default: null },
    /** Availability window; `null` means "no bound". */
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    /** Admin pause switch. Archived offers are hidden from every read. */
    isActive: { type: Boolean, default: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: "offers" },
);

offerSchema.index({ coffeeId: 1, archivedAt: 1, isActive: 1 });
offerSchema.index({ coffeeId: 1, createdAt: -1 });

export type OfferLine = InferSchemaType<typeof offerLineSchema>;
export type Offer = InferSchemaType<typeof offerSchema> & { _id: Types.ObjectId };

export const OfferModel = model<Offer>("Offer", offerSchema);
