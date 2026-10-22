import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { seedDatabase } from "../src/db/seed.js";
import { CoffeeModel } from "../src/models/coffee.model.js";
import { ItemCategoryModel } from "../src/models/item-category.model.js";
import { ItemModel } from "../src/models/item.model.js";
import { ServiceShiftModel } from "../src/models/service-shift.model.js";
import { TableSessionModel } from "../src/models/table-session.model.js";
import { setupTestDatabase, teardownTestDatabase, type TestDatabase } from "./helpers.js";

describe("coffee tables (backoffice view)", () => {
  let database: TestDatabase;
  let app: Express;
  let token: string;
  let itemId: string;

  const placeOrder = async (tableNumber: number, quantity = 1) => {
    const response = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber,
        items: [{ itemId, quantity }],
      });
    expect(response.status).toBe(201);
    return response.body.data as { id: string; tableSessionId: string; total: number };
  };

  const confirmOrder = async (orderId: string) => {
    const response = await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "CONFIRMED" });
    expect(response.status).toBe(200);
  };

  const payOrder = async (orderId: string) => {
    const response = await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${orderId}/payment`)
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
  };

  beforeAll(async () => {
    database = await setupTestDatabase();
    app = createApp();
  });

  beforeEach(async () => {
    await ServiceShiftModel.deleteMany({});
    await TableSessionModel.deleteMany({});
    await seedDatabase();
    const login = await request(app).post("/api/v1/admin/auth/coffee/cafe-el-manzah").send({ pin: "0000" });
    token = login.body.data.token;
    const coffee = await CoffeeModel.findOne({ slug: "cafe-el-manzah" }).lean().exec();
    const categoryIds = await ItemCategoryModel.find({ coffeeId: coffee!._id }).distinct("_id").exec();
    itemId = (await ItemModel.findOne({ itemCategoryId: { $in: categoryIds } })
      .lean()
      .exec())!._id.toString();
  });

  afterAll(async () => teardownTestDatabase(database));

  it("groups the sessions of a table into a single table card", async () => {
    const first = await placeOrder(12);
    const second = await placeOrder(12);

    expect(first.tableSessionId).not.toBe(second.tableSessionId);

    const list = await request(app).get("/api/v1/admin/my-coffee/tables").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(1);

    const table = list.body.data.tables[0];
    expect(table.tableNumber).toBe(12);
    expect(table.sessions).toBe(2);
    expect(table.orders).toHaveLength(2);
    expect(table.orders[0]).toMatchObject({ status: "PENDING", paymentStatus: "UNPAID", tableNumber: 12 });
    expect(table.orders[0].createdAt).toEqual(expect.any(String));
    expect(table.orders[0].items[0]).toMatchObject({ quantity: 1 });
    expect(table.totals).toEqual({
      totalOrders: 2,
      confirmedOrders: 0,
      pendingOrders: 2,
      rejectedOrders: 0,
      confirmedRevenue: 0,
      paidRevenue: 0,
      outstandingRevenue: 0,
      pendingRevenue: first.total + second.total,
    });
  });

  it("closes every session of a table at once", async () => {
    const opened = await request(app)
      .post("/api/v1/admin/my-coffee/shifts/open")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(opened.status).toBe(201);

    const first = await placeOrder(12);
    const second = await placeOrder(12);
    await confirmOrder(first.id);
    await payOrder(first.id);
    await confirmOrder(second.id);
    await payOrder(second.id);

    const closed = await request(app)
      .post("/api/v1/admin/my-coffee/tables/12/close")
      .set("Authorization", `Bearer ${token}`);
    expect(closed.status).toBe(200);
    expect(closed.body.data).toMatchObject({ tableNumber: 12, closedSessions: 2 });
    expect(closed.body.data.totals.paidRevenue).toBe(first.total + second.total);

    const sessions = await TableSessionModel.find({ tableNumber: 12 }).lean().exec();
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.status === "CLOSED")).toBe(true);

    const list = await request(app).get("/api/v1/admin/my-coffee/tables").set("Authorization", `Bearer ${token}`);
    expect(list.body.data.tables).toHaveLength(0);
  });

  it("refuses to close a table while an order is still pending", async () => {
    await request(app).post("/api/v1/admin/my-coffee/shifts/open").set("Authorization", `Bearer ${token}`).send({});
    const order = await placeOrder(12);

    const blocked = await request(app)
      .post("/api/v1/admin/my-coffee/tables/12/close")
      .set("Authorization", `Bearer ${token}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.code).toBe("TABLE_PENDING_ORDERS");
    expect(blocked.body.details.orders).toHaveLength(1);
    expect((await TableSessionModel.findById(order.tableSessionId).lean().exec())?.status).toBe("ACTIVE");
  });

  it("refuses to close a table while a confirmed order is unpaid", async () => {
    await request(app).post("/api/v1/admin/my-coffee/shifts/open").set("Authorization", `Bearer ${token}`).send({});
    const order = await placeOrder(12);
    await confirmOrder(order.id);

    const blocked = await request(app)
      .post("/api/v1/admin/my-coffee/tables/12/close")
      .set("Authorization", `Bearer ${token}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.code).toBe("TABLE_UNPAID_ORDERS");
    expect(blocked.body.details.orders).toHaveLength(1);
  });

  it("returns 404 when the table has no open session", async () => {
    const missing = await request(app)
      .post("/api/v1/admin/my-coffee/tables/99/close")
      .set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(404);
  });

  it("reports the open tables — not the sessions — when the service cannot be closed", async () => {
    await request(app).post("/api/v1/admin/my-coffee/shifts/open").set("Authorization", `Bearer ${token}`).send({});
    await placeOrder(12);
    await placeOrder(12);
    await placeOrder(13);

    const blocked = await request(app)
      .post("/api/v1/admin/my-coffee/shifts/close")
      .set("Authorization", `Bearer ${token}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.code).toBe("OPEN_TABLES_REMAIN");
    expect(blocked.body.details.tables).toEqual([
      { tableNumber: 12, orders: 2, revenue: 0 },
      { tableNumber: 13, orders: 1, revenue: 0 },
    ]);
  });

  it("blocks the service close on a table opened outside the shift", async () => {
    // The order is placed while no service is open: its session is bound to
    // no shift, but the table stays open and must be settled first.
    await placeOrder(12);
    await request(app).post("/api/v1/admin/my-coffee/shifts/open").set("Authorization", `Bearer ${token}`).send({});

    const blocked = await request(app)
      .post("/api/v1/admin/my-coffee/shifts/close")
      .set("Authorization", `Bearer ${token}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.code).toBe("OPEN_TABLES_REMAIN");
    expect(blocked.body.details.tables).toEqual([{ tableNumber: 12, orders: 1, revenue: 0 }]);
  });
});
