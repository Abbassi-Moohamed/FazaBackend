import { migrations } from "./index.js";

migrations.push({
  name: "0007_orders",
  async up({ db }) {
    await db.collection("orders").createIndex({ coffeeId: 1, createdAt: -1 });
    await db.collection("orders").createIndex({ coffeeId: 1, status: 1, createdAt: -1 });
  },
  async down({ db }) {
    await db
      .collection("orders")
      .dropIndexes()
      .catch(() => undefined);
  },
});
