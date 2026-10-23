import { model, Schema, type InferSchemaType, type Types } from "mongoose";

export const ORDER_STATUSES = ["PENDING", "CONFIRMED", "REJECTED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const PAYMENT_STATUSES = ["UNPAID", "PAID"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const orderItemSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    name: { type: String, required: true, trim: true },
    image: { type: String, default: null },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

/** One component of a purchased bundle, snapshotted for the kitchen. */
const orderOfferLineSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

/**
 * A daily offer purchased at its bundle price. The offer's name, price and
 * contents are snapshotted: later edits to the menu or the offer must never
 * rewrite an order that was already placed.
 */
const orderOfferSchema = new Schema(
  {
    offerId: { type: Schema.Types.ObjectId, ref: "Offer", required: true },
    name: { type: String, required: true, trim: true },
    image: { type: String, default: null },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
    lines: { type: [orderOfferLineSchema], default: [] },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    coffeeId: { type: Schema.Types.ObjectId, ref: "Coffee", required: true, index: true },
    tableNumber: { type: Number, required: true, min: 1, max: 10000 },
    items: {
      type: [orderItemSchema],
      default: [],
    },
    offers: {
      type: [orderOfferSchema],
      default: [],
    },
    total: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ORDER_STATUSES, default: "PENDING", index: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "UNPAID", index: true },
    paidAt: { type: Date, default: null },
    paidBy: { type: String, default: null, trim: true },
    // Nullable to preserve orders created before table sessions and shifts.
    tableSessionId: { type: Schema.Types.ObjectId, ref: "TableSession", default: null, index: true },
    serviceShiftId: { type: Schema.Types.ObjectId, ref: "ServiceShift", default: null, index: true },
  },
  { timestamps: true, versionKey: false, collection: "orders" },
);

orderSchema.index({ coffeeId: 1, createdAt: -1 });
orderSchema.index({ coffeeId: 1, status: 1, createdAt: -1 });
orderSchema.index({ coffeeId: 1, paymentStatus: 1, createdAt: -1 });
orderSchema.index({ coffeeId: 1, serviceShiftId: 1, createdAt: -1 });
orderSchema.index({ tableSessionId: 1, createdAt: -1 });

// An order is either a basket of items, a set of offers, or both. Validated at
// the document level because neither array alone is mandatory.
orderSchema.pre("validate", function () {
  if (this.items.length === 0 && this.offers.length === 0) {
    this.invalidate("items", "An order must contain at least one item or offer.");
  }
});

export type Order = InferSchemaType<typeof orderSchema> & { _id: Types.ObjectId };
export const OrderModel = model<Order>("Order", orderSchema);
