import { migrations } from "./index.js";

migrations.push({
  name: "0011_item_category_name_index",
  async up({ db }) {
    await db.collection("items").createIndex({ itemCategoryId: 1, name: 1 }, { name: "idx_items_category_name" });
  },
});
