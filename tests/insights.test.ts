import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "../src/app.js";
import { seedDatabase } from "../src/db/seed.js";
import { ItemModel } from "../src/models/item.model.js";
import { ItemCategoryModel } from "../src/models/item-category.model.js";
import { OrderModel } from "../src/models/order.model.js";
import { ItemViewModel } from "../src/models/item-view.model.js";
import { setupTestDatabase, teardownTestDatabase, type TestDatabase } from "./helpers.js";

const APP_PIN = "3219";
const BUNDLE = {
  coffeeId: "",
  tokens: { app: "", coffee: "" },
  itemIds: { espresso: "", cappuccino: "", coldBrew: "", coffeeEspresso: "", coffeeCappuccino: "" },
};

describe("insights", () => {
  let testDb: TestDatabase;
  let app: Express;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
    app = createApp();
    await seedDatabase();

    const appResponse = await request(app).post("/api/v1/admin/auth/app").send({ pin: APP_PIN });
    expect(appResponse.status).toBe(200);
    BUNDLE.tokens.app = appResponse.body.data.token;

    const coffeeResponse = await request(app).post("/api/v1/admin/auth/coffee/cafe-el-manzah").send({ pin: "0000" });
    expect(coffeeResponse.status).toBe(200);
    BUNDLE.tokens.coffee = coffeeResponse.body.data.token;

    const coffee = await request(app).get("/api/v1/coffees/cafe-el-manzah");
    BUNDLE.coffeeId = coffee.body.data.id;

    const items = await ItemModel.find({}).lean().exec();
    const byName = new Map(items.map((item) => [item.name, item._id.toString()]));
    BUNDLE.itemIds.espresso = byName.get("Espresso")!;
    BUNDLE.itemIds.cappuccino = byName.get("Cappuccino")!;
    BUNDLE.itemIds.coldBrew = byName.get("Cold Brew")!;

    // The item names are shared by several coffees: the menu of the coffee
    // under test is resolved through its own categories.
    const categoryIds = await ItemCategoryModel.find({ coffeeId: BUNDLE.coffeeId }).distinct("_id").exec();
    const coffeeItems = await ItemModel.find({ itemCategoryId: { $in: categoryIds } })
      .lean()
      .exec();
    const coffeeByName = new Map(coffeeItems.map((item) => [item.name, item._id.toString()]));
    BUNDLE.itemIds.coffeeEspresso = coffeeByName.get("Espresso")!;
    BUNDLE.itemIds.coffeeCappuccino = coffeeByName.get("Cappuccino")!;
  });

  afterEach(async () => {
    await teardownTestDatabase(testDb);
  });

  it("returns deterministic metrics and comparison values for a coffee", async () => {
    const espressoId = BUNDLE.itemIds.espresso;
    const cappuccinoId = BUNDLE.itemIds.cappuccino;
    const previous = new Date("2024-12-15T12:00:00.000Z");

    await OrderModel.insertMany([
      {
        coffeeId: BUNDLE.coffeeId,
        tableNumber: 2,
        items: [
          { itemId: espressoId, name: "Espresso", image: null, quantity: 2, unitPrice: 2.5, subtotal: 5 },
          { itemId: cappuccinoId, name: "Cappuccino", image: null, quantity: 1, unitPrice: 3.0, subtotal: 3 },
        ],
        total: 8,
        status: "CONFIRMED",
        createdAt: new Date("2025-01-15T12:00:00.000Z"),
        updatedAt: new Date("2025-01-15T12:00:00.000Z"),
      },
      {
        coffeeId: BUNDLE.coffeeId,
        tableNumber: 5,
        items: [
          { itemId: cappuccinoId, name: "Cappuccino", image: null, quantity: 3, unitPrice: 3.0, subtotal: 9 },
          { itemId: espressoId, name: "Espresso", image: null, quantity: 1, unitPrice: 2.5, subtotal: 2.5 },
        ],
        total: 11.5,
        status: "PENDING",
        createdAt: new Date("2025-01-25T12:00:00.000Z"),
        updatedAt: new Date("2025-01-25T12:00:00.000Z"),
      },
      {
        coffeeId: BUNDLE.coffeeId,
        tableNumber: 1,
        items: [{ itemId: espressoId, name: "Espresso", image: null, quantity: 1, unitPrice: 2.5, subtotal: 2.5 }],
        total: 2.5,
        status: "REJECTED",
        createdAt: new Date("2025-02-05T12:00:00.000Z"),
        updatedAt: new Date("2025-02-05T12:00:00.000Z"),
      },
      {
        coffeeId: (await request(app).get("/api/v1/coffees/brew-and-beans")).body.data.id,
        tableNumber: 3,
        items: [
          {
            itemId: BUNDLE.itemIds.coldBrew,
            name: "Cold Brew",
            image: null,
            quantity: 1,
            unitPrice: 4.5,
            subtotal: 4.5,
          },
        ],
        total: 4.5,
        status: "CONFIRMED",
        createdAt: new Date("2025-01-18T12:00:00.000Z"),
        updatedAt: new Date("2025-01-18T12:00:00.000Z"),
      },
      {
        coffeeId: BUNDLE.coffeeId,
        tableNumber: 7,
        items: [{ itemId: cappuccinoId, name: "Cappuccino", image: null, quantity: 2, unitPrice: 3.0, subtotal: 6 }],
        total: 6,
        status: "CONFIRMED",
        createdAt: previous,
        updatedAt: previous,
      },
    ]);

    const response = await request(app)
      .get("/api/v1/admin/my-coffee/insights")
      .set("Authorization", `Bearer ${BUNDLE.tokens.coffee}`)
      .query({ startDate: "2025-01-01", endDate: "2025-01-31" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.timezone).toBe("UTC");
    expect(response.body.data.metrics.orders).toBe(1);
    expect(response.body.data.metrics.revenue).toBe(8);
    expect(response.body.data.metrics.itemsSold).toBe(3);
    expect(response.body.data.metrics.averageOrderValue).toBe(8);
    expect(response.body.data.comparison.revenue.current).toBe(8);
    expect(response.body.data.comparison.revenue.previous).toBe(6);
    expect(response.body.data.topItems[0].name).toBe("Espresso");
    expect(response.body.data.topItems[0].revenue).toBe(5);
    expect(response.body.data.promotions.discountAmount).toBeNull();
  });

  it("supports app-admin filtering, date filters and empty data", async () => {
    const coffeeId = BUNDLE.coffeeId;
    const itemId = BUNDLE.itemIds.espresso;
    await OrderModel.create({
      coffeeId,
      tableNumber: 1,
      items: [{ itemId, name: "Espresso", image: null, quantity: 1, unitPrice: 2.5, subtotal: 2.5 }],
      total: 2.5,
      status: "CONFIRMED",
      createdAt: new Date("2025-01-10T12:00:00.000Z"),
      updatedAt: new Date("2025-01-10T12:00:00.000Z"),
    });

    const filtered = await request(app)
      .get(`/api/v1/admin/coffees/${coffeeId}/insights`)
      .set("Authorization", `Bearer ${BUNDLE.tokens.app}`)
      .query({ startDate: "2025-01-01", endDate: "2025-01-15T12:00:00.000Z" });

    expect(filtered.status).toBe(200);
    expect(filtered.body.data.metrics.orders).toBe(1);
    expect(filtered.body.data.period.startDate).toContain("2025-01-01T00:00:00");

    const empty = await request(app)
      .get(`/api/v1/admin/coffees/${coffeeId}/insights`)
      .set("Authorization", `Bearer ${BUNDLE.tokens.app}`)
      .query({ startDate: "2025-04-01", endDate: "2025-04-30" });

    expect(empty.status).toBe(200);
    expect(empty.body.data.metrics.orders).toBe(0);
    expect(empty.body.data.metrics.revenue).toBe(0);
    expect(empty.body.data.topItems).toEqual([]);
  });

  it("counts availability across every category owned by the coffee", async () => {
    const categoryIds = await ItemCategoryModel.find({ coffeeId: BUNDLE.coffeeId }).distinct("_id").exec();
    const coffeeItems = await ItemModel.find({ itemCategoryId: { $in: categoryIds } })
      .select({ _id: 1 })
      .lean()
      .exec();
    expect(categoryIds.length).toBeGreaterThan(1);
    expect(coffeeItems.length).toBeGreaterThan(2);

    await ItemModel.updateMany({ _id: { $in: coffeeItems.map((item) => item._id) } }, { $set: { isAvailable: false } });
    await ItemModel.updateOne({ _id: coffeeItems[0]!._id }, { $set: { isAvailable: true } });

    const response = await request(app)
      .get("/api/v1/admin/my-coffee/insights")
      .set("Authorization", `Bearer ${BUNDLE.tokens.coffee}`);

    expect(response.status).toBe(200);
    expect(response.body.data.availability.availableItems).toBe(1);
    expect(response.body.data.availability.unavailableItems).toBe(coffeeItems.length - 1);
  });

  it("counts null availability as available and only explicit false as unavailable", async () => {
    const categoryIds = await ItemCategoryModel.find({ coffeeId: BUNDLE.coffeeId }).distinct("_id").exec();
    const coffeeItems = await ItemModel.find({ itemCategoryId: { $in: categoryIds } })
      .select({ _id: 1 })
      .lean()
      .exec();
    expect(coffeeItems.length).toBeGreaterThan(1);

    await ItemModel.updateMany({ _id: { $in: coffeeItems.map((item) => item._id) } }, { $unset: { isAvailable: 1 } });
    await ItemModel.updateOne({ _id: coffeeItems[0]!._id }, { $set: { isAvailable: false } });
    await ItemModel.updateOne({ _id: coffeeItems[1]!._id }, { $set: { isAvailable: null } });

    const response = await request(app)
      .get("/api/v1/admin/my-coffee/insights")
      .set("Authorization", `Bearer ${BUNDLE.tokens.coffee}`);

    expect(response.status).toBe(200);
    expect(response.body.data.availability.unavailableItems).toBe(1);
    expect(response.body.data.availability.availableItems).toBe(coffeeItems.length - 1);
  });

  it("computes the basket size, the rejection rate and the hourly revenue", async () => {
    const espressoId = BUNDLE.itemIds.coffeeEspresso;
    const cappuccinoId = BUNDLE.itemIds.coffeeCappuccino;

    await OrderModel.insertMany([
      {
        coffeeId: BUNDLE.coffeeId,
        tableNumber: 2,
        items: [
          { itemId: espressoId, name: "Espresso", image: null, quantity: 2, unitPrice: 2.5, subtotal: 5 },
          { itemId: cappuccinoId, name: "Cappuccino", image: null, quantity: 1, unitPrice: 4.0, subtotal: 4 },
        ],
        total: 9,
        status: "CONFIRMED",
        createdAt: new Date("2025-03-10T10:30:00.000Z"),
        updatedAt: new Date("2025-03-10T10:30:00.000Z"),
      },
      {
        coffeeId: BUNDLE.coffeeId,
        tableNumber: 3,
        items: [{ itemId: espressoId, name: "Espresso", image: null, quantity: 1, unitPrice: 2.5, subtotal: 2.5 }],
        total: 2.5,
        status: "REJECTED",
        createdAt: new Date("2025-03-11T10:30:00.000Z"),
        updatedAt: new Date("2025-03-11T10:30:00.000Z"),
      },
    ]);

    const response = await request(app)
      .get("/api/v1/admin/my-coffee/insights")
      .set("Authorization", `Bearer ${BUNDLE.tokens.coffee}`)
      .query({ startDate: "2025-03-01", endDate: "2025-03-31" });

    expect(response.status).toBe(200);
    expect(response.body.data.kpis.averageItemsPerOrder.current).toBe(3);
    expect(response.body.data.kpis.averageItemsPerOrder.previous).toBe(0);
    expect(response.body.data.kpis.rejectionRate.current).toBe(50);
    expect(response.body.data.kpis.rejectionRate.trend).toBe("up");
    expect(response.body.data.hourly).toEqual([{ hour: 10, orders: 1, revenue: 9 }]);
    expect(response.body.data.peakHours).toEqual([{ hour: 10, orders: 1 }]);
  });

  it("compares views to distinct confirmed orders and sold units", async () => {
    const espressoId = BUNDLE.itemIds.coffeeEspresso;
    const cappuccinoId = BUNDLE.itemIds.coffeeCappuccino;
    const viewDate = new Date("2025-03-10T00:00:00.000Z");
    await ItemViewModel.create({ coffeeId: BUNDLE.coffeeId, itemId: espressoId, viewDate, views: 10 });
    await ItemViewModel.create({ coffeeId: BUNDLE.coffeeId, itemId: cappuccinoId, viewDate, views: 30 });
    await OrderModel.create({
      coffeeId: BUNDLE.coffeeId,
      tableNumber: 8,
      items: [
        { itemId: espressoId, name: "Espresso", image: null, quantity: 2, unitPrice: 2.5, subtotal: 5 },
        { itemId: espressoId, name: "Espresso", image: null, quantity: 1, unitPrice: 2.5, subtotal: 2.5 },
      ],
      total: 7.5,
      status: "CONFIRMED",
      createdAt: new Date("2025-03-10T12:00:00.000Z"),
      updatedAt: new Date("2025-03-10T12:00:00.000Z"),
    });
    await OrderModel.create({
      coffeeId: BUNDLE.coffeeId,
      tableNumber: 9,
      items: [{ itemId: cappuccinoId, name: "Cappuccino", image: null, quantity: 1, unitPrice: 3, subtotal: 3 }],
      total: 3,
      status: "CONFIRMED",
      createdAt: new Date("2025-03-10T13:00:00.000Z"),
      updatedAt: new Date("2025-03-10T13:00:00.000Z"),
    });

    const response = await request(app)
      .get("/api/v1/admin/my-coffee/insights")
      .set("Authorization", "Bearer " + BUNDLE.tokens.coffee)
      .query({ startDate: "2025-03-10T00:00:00.000Z", endDate: "2025-03-11T00:00:00.000Z" });

    expect(response.status).toBe(200);
    expect(response.body.data.itemEngagementSummary).toEqual({
      views: 40,
      itemOrders: 2,
      unitsSold: 4,
      ordersPer100Views: 5,
    });
    expect(response.body.data.itemEngagement).toContainEqual(
      expect.objectContaining({
        itemId: espressoId,
        views: 10,
        confirmedOrders: 1,
        unitsSold: 3,
        viewsSharePercent: 25,
        ordersSharePercent: 50,
        interestGapPoints: -25,
        ordersPer100Views: 10,
      }),
    );
    expect(response.body.data.itemEngagement).toContainEqual(
      expect.objectContaining({
        itemId: cappuccinoId,
        viewsSharePercent: 75,
        ordersSharePercent: 50,
        interestGapPoints: 25,
        ordersPer100Views: 3.3,
      }),
    );
  });

  it("splits the revenue per category and lists the items that never sold", async () => {
    const espressoId = BUNDLE.itemIds.coffeeEspresso;
    const cappuccinoId = BUNDLE.itemIds.coffeeCappuccino;

    await OrderModel.create({
      coffeeId: BUNDLE.coffeeId,
      tableNumber: 4,
      items: [
        { itemId: espressoId, name: "Espresso", image: null, quantity: 2, unitPrice: 2.5, subtotal: 5 },
        { itemId: cappuccinoId, name: "Cappuccino", image: null, quantity: 1, unitPrice: 4.0, subtotal: 4 },
      ],
      total: 9,
      status: "CONFIRMED",
      createdAt: new Date("2025-05-05T09:00:00.000Z"),
      updatedAt: new Date("2025-05-05T09:00:00.000Z"),
    });

    const response = await request(app)
      .get("/api/v1/admin/my-coffee/insights")
      .set("Authorization", `Bearer ${BUNDLE.tokens.coffee}`)
      .query({ startDate: "2025-05-01", endDate: "2025-05-31" });

    expect(response.status).toBe(200);

    const categories = response.body.data.categories;
    expect(categories.length).toBeGreaterThan(0);
    const coffeeCategory = categories.find((category: { categoryName: string }) => category.categoryName === "Cafés");
    expect(coffeeCategory.quantitySold).toBe(3);
    expect(coffeeCategory.revenue).toBe(9);
    expect(coffeeCategory.percentageOfRevenue).toBe(100);

    const catalogSize = await ItemModel.countDocuments({
      itemCategoryId: { $in: await ItemCategoryModel.find({ coffeeId: BUNDLE.coffeeId }).distinct("_id").exec() },
    }).exec();
    expect(response.body.data.deadStock.unsoldItems).toBe(catalogSize - 2);
    const deadNames = response.body.data.deadStock.items.map((item: { name: string }) => item.name);
    expect(deadNames).toContain("Cheesecake");
    expect(deadNames).not.toContain("Espresso");

    const insightIds = response.body.data.insights.map((insight: { id: string }) => insight.id);
    expect(insightIds).toContain("dead-stock");
    expect(insightIds).toContain("leading-category");
  });
});
