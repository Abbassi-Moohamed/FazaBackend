import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { seedDatabase } from "../src/db/seed.js";
import { CoffeeModel } from "../src/models/coffee.model.js";
import { ItemCategoryModel } from "../src/models/item-category.model.js";
import { ItemModel } from "../src/models/item.model.js";
import { TableSessionModel } from "../src/models/table-session.model.js";
import { setupTestDatabase, teardownTestDatabase, type TestDatabase } from "./helpers.js";

interface PlacedOrder {
  id: string;
  tableSessionId: string;
  sessionToken: string;
}

describe("session order history", () => {
  let database: TestDatabase;
  let app: Express;
  let itemId: string;

  beforeAll(async () => {
    database = await setupTestDatabase();
    app = createApp();
  });

  beforeEach(async () => {
    await TableSessionModel.deleteMany({});
    await seedDatabase();
    const coffee = await CoffeeModel.findOne({ slug: "cafe-el-manzah" }).lean().exec();
    const categoryIds = await ItemCategoryModel.find({ coffeeId: coffee!._id }).distinct("_id").exec();
    itemId = (await ItemModel.findOne({ itemCategoryId: { $in: categoryIds } })
      .lean()
      .exec())!._id.toString();
  });

  afterAll(async () => teardownTestDatabase(database));

  async function placeOrder(tableNumber: number, sessionToken?: string): Promise<PlacedOrder> {
    const response = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: "cafe-el-manzah",
        tableNumber,
        ...(sessionToken ? { sessionToken } : {}),
        items: [{ itemId, quantity: 1 }],
      });
    expect(response.status).toBe(201);
    return response.body.data as PlacedOrder;
  }

  it("returns every order of a session, newest first", async () => {
    const first = await placeOrder(3);
    const second = await placeOrder(3, first.sessionToken);
    const third = await placeOrder(3, first.sessionToken);

    const response = await request(app).get("/api/v1/orders").query({ sessionToken: first.sessionToken });
    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(3);
    expect(response.body.data.orders).toHaveLength(3);
    expect(response.body.data.orders.map((order: { id: string }) => order.id)).toEqual([third.id, second.id, first.id]);
    expect(response.body.data.session.tableNumber).toBe(3);
    expect(response.body.data.session.status).toBe("ACTIVE");
  });

  it("keeps the orders of two parties at the same table apart", async () => {
    const ours = await placeOrder(7);
    const other = await placeOrder(7);
    expect(other.tableSessionId).not.toBe(ours.tableSessionId);

    const mine = await request(app).get("/api/v1/orders").query({ sessionToken: ours.sessionToken });
    expect(mine.status).toBe(200);
    expect(mine.body.data.orders.map((order: { id: string }) => order.id)).toEqual([ours.id]);

    const theirs = await request(app).get("/api/v1/orders").query({ sessionToken: other.sessionToken });
    expect(theirs.status).toBe(200);
    expect(theirs.body.data.orders.map((order: { id: string }) => order.id)).toEqual([other.id]);
  });

  it("rejects a history request without a usable session token", async () => {
    const missing = await request(app).get("/api/v1/orders");
    expect(missing.status).toBe(401);

    const invalid = await request(app).get("/api/v1/orders").query({ sessionToken: "not-a-real-session-token" });
    expect(invalid.status).toBe(401);
  });

  it("keeps the history readable once the session is closed", async () => {
    const order = await placeOrder(9);
    await TableSessionModel.updateOne(
      { _id: order.tableSessionId },
      { $set: { status: "CLOSED", closedAt: new Date() } },
    ).exec();

    const response = await request(app).get("/api/v1/orders").query({ sessionToken: order.sessionToken });
    expect(response.status).toBe(200);
    expect(response.body.data.orders).toHaveLength(1);
    expect(response.body.data.session.status).toBe("CLOSED");
  });
});
