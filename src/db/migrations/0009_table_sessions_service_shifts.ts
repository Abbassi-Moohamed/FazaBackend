import { migrations } from "./index.js";

migrations.push({
  name: "0009_table_sessions_service_shifts",
  async up({ db }) {
    await ensureCollection(db, "service_shifts");
    await ensureCollection(db, "table_sessions");

    // Existing orders remain valid and explicitly carry nullable references.
    await db.collection("orders").updateMany({}, [
      {
        $set: {
          tableSessionId: { $ifNull: ["$tableSessionId", null] },
          serviceShiftId: { $ifNull: ["$serviceShiftId", null] },
        },
      },
    ]);

    // Repair duplicate legacy active rows before installing partial unique
    // indexes. The newest row remains active; older rows are closed.
    await closeDuplicateActiveSessions(db);
    await closeDuplicateOpenShifts(db);

    await db
      .collection("service_shifts")
      .createIndex(
        { coffeeId: 1, status: 1 },
        { unique: true, partialFilterExpression: { status: "OPEN" }, name: "uq_service_shifts_active_coffee" },
      );
    await db
      .collection("service_shifts")
      .createIndex({ coffeeId: 1, openedAt: -1 }, { name: "idx_service_shifts_coffee_opened" });
    await db
      .collection("table_sessions")
      .createIndex(
        { coffeeId: 1, tableNumber: 1 },
        { unique: true, partialFilterExpression: { status: "ACTIVE" }, name: "uq_table_sessions_active_table" },
      );
    await db
      .collection("table_sessions")
      .createIndex({ sessionTokenHash: 1 }, { unique: true, name: "uq_table_sessions_token_hash" });
    await db
      .collection("table_sessions")
      .createIndex({ coffeeId: 1, serviceShiftId: 1, createdAt: -1 }, { name: "idx_table_sessions_shift" });
    await db
      .collection("table_sessions")
      .createIndex({ coffeeId: 1, status: 1, lastOrderAt: -1 }, { name: "idx_table_sessions_status" });
    await db
      .collection("orders")
      .createIndex({ coffeeId: 1, serviceShiftId: 1, createdAt: -1 }, { name: "idx_orders_coffee_shift_created" });
    await db
      .collection("orders")
      .createIndex({ tableSessionId: 1, createdAt: -1 }, { name: "idx_orders_table_session_created" });
  },
});

async function ensureCollection(db: import("mongodb").Db, name: string): Promise<void> {
  try {
    await db.createCollection(name);
  } catch (error) {
    const record = error as { code?: number; message?: string };
    if (record.code !== 48 && !/already exists/i.test(record.message ?? "")) throw error;
  }
}

async function closeDuplicateActiveSessions(db: import("mongodb").Db): Promise<void> {
  const duplicates = await db
    .collection("table_sessions")
    .aggregate([
      { $match: { status: "ACTIVE" } },
      { $sort: { openedAt: -1, createdAt: -1 } },
      {
        $group: {
          _id: { coffeeId: "$coffeeId", tableNumber: "$tableNumber" },
          ids: { $push: "$_id" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  for (const duplicate of duplicates) {
    const [keep, ...close] = duplicate.ids;
    if (close.length > 0)
      await db
        .collection("table_sessions")
        .updateMany({ _id: { $in: close } }, { $set: { status: "CLOSED", closedAt: new Date() } });
    void keep;
  }
}

async function closeDuplicateOpenShifts(db: import("mongodb").Db): Promise<void> {
  const duplicates = await db
    .collection("service_shifts")
    .aggregate([
      { $match: { status: "OPEN" } },
      { $sort: { openedAt: -1, createdAt: -1 } },
      { $group: { _id: "$coffeeId", ids: { $push: "$_id" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  for (const duplicate of duplicates) {
    const [, ...close] = duplicate.ids;
    if (close.length > 0)
      await db
        .collection("service_shifts")
        .updateMany({ _id: { $in: close } }, { $set: { status: "CLOSED", closedAt: new Date() } });
  }
}
