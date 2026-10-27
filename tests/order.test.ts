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
import { changeOrderStatus } from "../src/services/order.service.js";
import { setupTestDatabase, teardownTestDatabase, type TestDatabase } from "./helpers.js";

describe("visitor ordering", () => {
  let database: TestDatabase;
  let app: Express;

  beforeAll(async () => {
    database = await setupTestDatabase();
    app = createApp();
  });
  beforeEach(() => seedDatabase());
  afterAll(async () => teardownTestDatabase(database));

  it("accepts an item-only order that explicitly sends an empty offers array", async () => {
    const coffee = await CoffeeModel.findOne({ slug: "cafe-el-manzah" }).lean().exec();
    const categoryIds = await ItemCategoryModel.find({ coffeeId: coffee!._id }).distinct("_id").exec();
    const item = await ItemModel.findOne({ itemCategoryId: { $in: categoryIds } })
      .lean()
      .exec();

    const response = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 1,
        items: [{ itemId: item!._id.toString(), quantity: 1 }],
        offers: [],
      });
    expect(response.status).toBe(201);
  });

  it("checks ownership, availability and calculates a promotional total server-side", async () => {
    const coffee = await CoffeeModel.findOne({ slug: "cafe-el-manzah" }).lean().exec();
    const categoryIds = await ItemCategoryModel.find({ coffeeId: coffee!._id }).distinct("_id").exec();
    const item = await ItemModel.findOne({ itemCategoryId: { $in: categoryIds } })
      .lean()
      .exec();
    expect(coffee).toBeTruthy();
    expect(item).toBeTruthy();

    await ItemModel.updateOne({ _id: item!._id }, { $set: { price: 10, promotion: 7 } });
    const response = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 12,
        items: [{ itemId: item!._id.toString(), quantity: 2 }],
      });
    expect(response.status).toBe(201);
    expect(response.body.data.total).toBe(14);
    expect(response.body.data.items[0].subtotal).toBe(14);
    expect(response.body.data.status).toBe("PENDING");
    const fetched = await request(app).get(`/api/v1/orders/${response.body.data.id}`);
    expect(fetched.status).toBe(401);

    const fetchedWithToken = await request(app)
      .get(`/api/v1/orders/${response.body.data.id}`)
      .set("x-session-token", response.body.data.sessionToken);
    expect(fetchedWithToken.status).toBe(200);
    expect(fetchedWithToken.body.data.tableNumber).toBe(12);
    expect(fetchedWithToken.body.data.total).toBe(14);
  });

  it("rejects reading a session-bound order with another session's token", async () => {
    const coffee = await CoffeeModel.findOne({ slug: "cafe-el-manzah" }).lean().exec();
    const categoryIds = await ItemCategoryModel.find({ coffeeId: coffee!._id }).distinct("_id").exec();
    const item = await ItemModel.findOne({ itemCategoryId: { $in: categoryIds } })
      .lean()
      .exec();
    const first = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 3,
        items: [{ itemId: item!._id.toString(), quantity: 1 }],
      });
    const second = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 4,
        items: [{ itemId: item!._id.toString(), quantity: 1 }],
      });

    const response = await request(app)
      .get(`/api/v1/orders/${first.body.data.id}`)
      .set("x-session-token", second.body.data.sessionToken);
    expect(response.status).toBe(401);
  });

  it("does not accept an item belonging to another coffee", async () => {
    const item = await ItemModel.findOne().lean().exec();
    const response = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "coffee-leaf",
        tableNumber: 1,
        items: [{ itemId: item!._id.toString(), quantity: 1 }],
      });
    expect(response.status).toBe(400);
  });

  it("blocks confirmation when the coffee has no active service", async () => {
    const coffee = await CoffeeModel.findOne({ slug: "cafe-el-manzah" }).lean().exec();
    const categoryIds = await ItemCategoryModel.find({ coffeeId: coffee!._id }).distinct("_id").exec();
    const item = await ItemModel.findOne({ itemCategoryId: { $in: categoryIds } })
      .lean()
      .exec();
    await ServiceShiftModel.deleteMany({ coffeeId: coffee!._id });
    const created = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 2,
        items: [{ itemId: item!._id.toString(), quantity: 1 }],
      });

    await expect(changeOrderStatus(coffee!._id.toString(), created.body.data.id, "CONFIRMED")).rejects.toMatchObject({
      statusCode: 409,
      details: { code: "NO_ACTIVE_SERVICE" },
    });
    expect((await OrderModel.findById(created.body.data.id).lean().exec())?.status).toBe("PENDING");
  });

  it("scopes coffee-admin order operations and enforces status transitions", async () => {
    const coffee = await CoffeeModel.findOne({ slug: "cafe-el-manzah" }).lean().exec();
    const categoryIds = await ItemCategoryModel.find({ coffeeId: coffee!._id }).distinct("_id").exec();
    const item = await ItemModel.findOne({ itemCategoryId: { $in: categoryIds } })
      .lean()
      .exec();
    const created = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 1,
        items: [{ itemId: item!._id.toString(), quantity: 1 }],
      });
    const login = await request(app).post("/api/v1/admin/auth/coffee/cafe-el-manzah").send({ pin: "0000" });
    const token = login.body.data.token as string;
    await ServiceShiftModel.create({
      coffeeId: coffee!._id,
      status: "OPEN",
      type: "MORNING",
      name: "Morning",
      openedByRole: "COFFEE_ADMIN",
    });
    const orderId = created.body.data.id as string;
    const listed = await request(app).get("/api/v1/admin/my-coffee/orders").set("Authorization", `Bearer ${token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.orders.some((order: { id: string }) => order.id === orderId)).toBe(true);

    const confirmed = await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "CONFIRMED" });
    expect(confirmed.status).toBe(200);
    const invalid = await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "REJECTED" });
    expect(invalid.status).toBe(409);
  });

  it("allows only a confirmed unpaid order to be marked paid", async () => {
    const coffee = await CoffeeModel.findOne({ slug: "cafe-el-manzah" }).lean().exec();
    const categoryIds = await ItemCategoryModel.find({ coffeeId: coffee!._id }).distinct("_id").exec();
    const item = await ItemModel.findOne({ itemCategoryId: { $in: categoryIds } })
      .lean()
      .exec();
    const created = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 8,
        items: [{ itemId: item!._id.toString(), quantity: 1 }],
      });
    const login = await request(app).post("/api/v1/admin/auth/coffee/cafe-el-manzah").send({ pin: "0000" });
    const token = login.body.data.token as string;
    await ServiceShiftModel.create({
      coffeeId: coffee!._id,
      status: "OPEN",
      type: "MORNING",
      name: "Morning",
      openedByRole: "COFFEE_ADMIN",
    });
    const orderId = created.body.data.id as string;

    const pendingPayment = await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${orderId}/payment`)
      .set("Authorization", `Bearer ${token}`);
    expect(pendingPayment.status).toBe(409);

    await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "CONFIRMED" });
    const paid = await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${orderId}/payment`)
      .set("Authorization", `Bearer ${token}`);
    expect(paid.status).toBe(200);
    expect(paid.body.data.paymentStatus).toBe("PAID");
    expect(paid.body.data.paidAt).toBeTruthy();

    const duplicate = await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${orderId}/payment`)
      .set("Authorization", `Bearer ${token}`);
    expect(duplicate.status).toBe(409);
    const stored = await OrderModel.findById(orderId).lean().exec();
    expect(stored?.paymentStatus).toBe("PAID");
  });

  it("does not allow a visitor or another coffee admin to validate payment", async () => {
    const coffee = await CoffeeModel.findOne({ slug: "cafe-el-manzah" }).lean().exec();
    const categoryIds = await ItemCategoryModel.find({ coffeeId: coffee!._id }).distinct("_id").exec();
    const item = await ItemModel.findOne({ itemCategoryId: { $in: categoryIds } })
      .lean()
      .exec();
    const created = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber: 9,
        items: [{ itemId: item!._id.toString(), quantity: 1 }],
      });
    const orderId = created.body.data.id as string;
    const visitor = await request(app).patch(`/api/v1/admin/my-coffee/orders/${orderId}/payment`);
    expect(visitor.status).toBe(401);
    const otherAdmin = await request(app).post("/api/v1/admin/auth/coffee/coffee-leaf").send({ pin: "0000" });
    const wrongCoffee = await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${orderId}/payment`)
      .set("Authorization", `Bearer ${otherAdmin.body.data.token}`);
    expect(wrongCoffee.status).toBe(404);
  });
});
