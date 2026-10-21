import { migrations } from "./index.js";

/**
 * A table can host several concurrent sessions (different parties sharing a
 * table). The session token — not the table number — identifies the customer,
 * so the "one active session per table" invariant is replaced by a plain
 * lookup index.
 */
migrations.push({
  name: "0012_multiple_sessions_per_table",
  async up({ db }) {
    const sessions = db.collection("table_sessions");
    const indexes = await sessions.indexes();
    if (indexes.some((index) => index.name === "uq_table_sessions_active_table")) {
      await sessions.dropIndex("uq_table_sessions_active_table");
    }
    await sessions.createIndex(
      { coffeeId: 1, tableNumber: 1, status: 1, lastOrderAt: -1 },
      { name: "idx_table_sessions_table_status" },
    );
  },
});
