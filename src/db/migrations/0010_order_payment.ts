import { migrations } from "./index.js";

migrations.push({
  name: "0010_order_payment",
  async up({ db }) {
    await db
      .collection("orders")
      .updateMany(
        { paymentStatus: { $exists: false } },
        { $set: { paymentStatus: "UNPAID", paidAt: null, paidBy: null } },
      );
    await db
      .collection("orders")
      .createIndex({ coffeeId: 1, paymentStatus: 1, createdAt: -1 }, { name: "idx_orders_coffee_payment_created" });
  },
});
