import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const itemCategorySchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Category name is required."],
      trim: true,
      maxlength: [80, "Category name must be at most 80 characters."],
    },
    image: {
      type: String,
      trim: true,
      default: null,
    },
    imageId: {
      type: String,
      trim: true,
      default: null,
    },
    coffeeId: {
      type: Schema.Types.ObjectId,
      ref: "Coffee",
      required: [true, "A category must belong to a coffee."],
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "itemcategories",
  },
);

// A coffee cannot own two categories with the same name.
itemCategorySchema.index({ coffeeId: 1, name: 1 }, { unique: true });
itemCategorySchema.index({ coffeeId: 1 });

itemCategorySchema.virtual("items", {
  ref: "Item",
  localField: "_id",
  foreignField: "itemCategoryId",
});

export type ItemCategory = InferSchemaType<typeof itemCategorySchema> & {
  _id: Types.ObjectId;
};

export const ItemCategoryModel = model<ItemCategory>("ItemCategory", itemCategorySchema);
