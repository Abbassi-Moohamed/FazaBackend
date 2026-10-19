import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { seedDatabase } from "../src/db/seed.js";
import { CoffeeModel } from "../src/models/coffee.model.js";
import { ItemCategoryModel } from "../src/models/item-category.model.js";
import { ItemModel } from "../src/models/item.model.js";
import { OrderModel } from "../src/models/order.model.js";
import { ServiceShiftModel } from "../src/models/service-shift.model.js";
import { TableSessionModel } from "../src/models/table-session.model.js";
import { setupTestDatabase, teardownTestDatabase, type TestDatabase } from "./helpers.js";

describe("table sessions and service shifts", () => {
  let database: TestDatabase;
  let app: Express;
  let token: string;
  let itemId: string;

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

  it("issues and validates a server-generated token while grouping orders by table", async () => {
    const first = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 4,
        items: [{ itemId, quantity: 1 }],
      });
    expect(first.status).toBe(201);
    expect(first.body.data.sessionToken).toEqual(expect.any(String));
    expect(first.body.data.serviceShiftId).toBeNull();

    const second = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 4,
        sessionToken: first.body.data.sessionToken,
        items: [{ itemId, quantity: 1 }],
      });
    expect(second.status).toBe(201);
    expect(second.body.data.tableSessionId).toBe(first.body.data.tableSessionId);

    const invalid = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 4,
        sessionToken: "not-a-real-session-token",
        items: [{ itemId, quantity: 1 }],
      });
    expect(invalid.status).toBe(401);
  });

  it("supports an explicitly scoped shift lifecycle and shift summaries", async () => {
    const opened = await request(app)
      .post("/api/v1/admin/my-coffee/shifts/open")
      .set("Authorization", `Bearer ${token}`)
      .send({ label: "Morning" });
    expect(opened.status).toBe(201);
    const shiftId = opened.body.data.id as string;

    const duplicate = await request(app)
      .post("/api/v1/admin/my-coffee/service-shifts/open")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(duplicate.status).toBe(409);

    const order = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 8,
        items: [{ itemId, quantity: 1 }],
      });
    expect(order.status).toBe(201);
    expect(order.body.data.serviceShiftId).toBe(shiftId);

    const detail = await request(app)
      .get(`/api/v1/admin/my-coffee/shifts/${shiftId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.summary.totalOrders).toBe(1);
    await TableSessionModel.updateOne(
      { _id: order.body.data.tableSessionId },
      { $set: { status: "CLOSED", closedAt: new Date() } },
    ).exec();

    const closed = await request(app)
      .post(`/api/v1/admin/my-coffee/service-shifts/${shiftId}/close`)
      .set("Authorization", `Bearer ${token}`);
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("CLOSED");
  });

  it("treats repeated table closure as idempotent", async () => {
    const order = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 11,
        items: [{ itemId, quantity: 1 }],
      });
    expect(order.status).toBe(201);
    const sessionId = order.body.data.tableSessionId as string;

    await OrderModel.updateOne({ _id: order.body.data.id }, { $set: { status: "REJECTED" } }).exec();

    const first = await request(app)
      .patch(`/api/v1/admin/my-coffee/table-sessions/${sessionId}/close`)
      .set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("CLOSED");

    const repeated = await request(app)
      .patch(`/api/v1/admin/my-coffee/table-sessions/${sessionId}/close`)
      .set("Authorization", `Bearer ${token}`);
    expect(repeated.status).toBe(200);
    expect(repeated.body.data.status).toBe("CLOSED");
  });

  it("blocks closing a table while a confirmed order remains unpaid", async () => {
    const coffee = await CoffeeModel.findOne({ slug: "cafe-el-manzah" }).lean().exec();
    await ServiceShiftModel.create({
      coffeeId: coffee!._id,
      status: "OPEN",
      type: "MORNING",
      name: "Morning",
      openedByRole: "COFFEE_ADMIN",
    });
    const order = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 12,
        items: [{ itemId, quantity: 1 }],
      });
    expect(order.status).toBe(201);
    const orderId = order.body.data.id as string;
    const sessionId = order.body.data.tableSessionId as string;

    const confirmed = await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "CONFIRMED" });
    expect(confirmed.status).toBe(200);

    const blocked = await request(app)
      .patch(`/api/v1/admin/my-coffee/table-sessions/${sessionId}/close`)
      .set("Authorization", `Bearer ${token}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.code).toBe("TABLE_UNPAID_ORDERS");
    expect(blocked.body.details.orders).toHaveLength(1);
    expect((await TableSessionModel.findById(sessionId).lean().exec())?.status).toBe("ACTIVE");

    const paid = await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${orderId}/payment`)
      .set("Authorization", `Bearer ${token}`);
    expect(paid.status).toBe(200);

    const closed = await request(app)
      .patch(`/api/v1/admin/my-coffee/table-sessions/${sessionId}/close`)
      .set("Authorization", `Bearer ${token}`);
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("CLOSED");
  });
});
