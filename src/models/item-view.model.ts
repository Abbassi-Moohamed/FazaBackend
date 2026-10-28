import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const itemViewSchema = new Schema(
  {
    coffeeId: { type: Schema.Types.ObjectId, ref: "Coffee", required: true },
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    viewDate: { type: Date, required: true },
    views: { type: Number, required: true, min: 1, default: 1 },
  },
  { versionKey: false, collection: "itemviews" },
);

itemViewSchema.index({ coffeeId: 1, itemId: 1, viewDate: 1 }, { unique: true });
itemViewSchema.index({ coffeeId: 1, viewDate: 1 });
itemViewSchema.index({ viewDate: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });

export type ItemView = InferSchemaType<typeof itemViewSchema> & { _id: Types.ObjectId };
export const ItemViewModel = model<ItemView>("ItemView", itemViewSchema);
