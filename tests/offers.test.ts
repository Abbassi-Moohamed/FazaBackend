import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "../src/app.js";
import { seedDatabase } from "../src/db/seed.js";
import { CoffeeModel } from "../src/models/coffee.model.js";
import { ItemCategoryModel } from "../src/models/item-category.model.js";
import { ItemModel } from "../src/models/item.model.js";
import { OfferModel } from "../src/models/offer.model.js";
import type { AdminAuthDto, AdminOfferDto, FeaturedOfferDto, OrderDto } from "../src/types/index.js";
import { setupTestDatabase, teardownTestDatabase, type TestDatabase } from "./helpers.js";

const SLUG = "cafe-el-manzah";
const OTHER_SLUG = "coffee-leaf";
const PIN = "0000";

describe("daily offers", () => {
  let database: TestDatabase;
  let app: Express;

  beforeAll(async () => {
    database = await setupTestDatabase();
    app = createApp();
  });
  beforeEach(async () => {
    await seedDatabase();
  });
  afterAll(async () => teardownTestDatabase(database));

  async function login(slug: string = SLUG): Promise<string> {
    const response = await request(app).post(`/api/v1/admin/auth/coffee/${slug}`).send({ pin: PIN });
    expect(response.status).toBe(200);
    return (response.body.data as AdminAuthDto).token;
  }

  /** Two deterministic, available items of the coffee (price 5 and 3). */
  async function pricedItems(slug: string = SLUG) {
    const coffee = await CoffeeModel.findOne({ slug }).lean().exec();
    const categoryIds = await ItemCategoryModel.find({ coffeeId: coffee!._id }).distinct("_id").exec();
    const items = await ItemModel.find({ itemCategoryId: { $in: categoryIds } })
      .sort({ name: 1 })
      .limit(2)
      .lean()
      .exec();
    expect(items.length).toBe(2);
    await ItemModel.updateOne({ _id: items[0]!._id }, { $set: { price: 5, promotion: null, isAvailable: true } });
    await ItemModel.updateOne({ _id: items[1]!._id }, { $set: { price: 3, promotion: null, isAvailable: true } });
    return items;
  }

  function offerBody(items: { _id: { toString(): string } }[], overrides: Record<string, unknown> = {}) {
    return {
      name: "Formule du jour",
      description: "Un café et une pâtisserie",
      price: 6.5,
      stock: 5,
      lines: items.map((item) => ({ itemId: item._id.toString(), quantity: 1 })),
      ...overrides,
    };
  }

  async function createOffer(token: string, body: Record<string, unknown>): Promise<AdminOfferDto> {
    const response = await request(app)
      .post("/api/v1/admin/my-coffee/offers")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(response.status).toBe(201);
    return response.body.data as AdminOfferDto;
  }

  it("creates, lists, updates and archives an offer with live component prices", async () => {
    const items = await pricedItems();
    const token = await login();

    const created = await createOffer(token, offerBody(items));
    expect(created.price).toBe(6.5);
    expect(created.originalPrice).toBe(8);
    expect(created.savings).toBe(1.5);
    expect(created.status).toBe("ACTIVE");
    expect(created.lines).toHaveLength(2);
    expect(created.lines[0]!.unitPrice).toBe(5);

    const listed = await request(app).get("/api/v1/admin/my-coffee/offers").set("Authorization", `Bearer ${token}`);
    expect(listed.status).toBe(200);
    expect((listed.body.data as AdminOfferDto[]).map((offer) => offer.id)).toContain(created.id);

    const updated = await request(app)
      .patch(`/api/v1/admin/my-coffee/offers/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Formule express", stock: 2 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe("Formule express");
    expect(updated.body.data.stock).toBe(2);

    const tooExpensive = await request(app)
      .patch(`/api/v1/admin/my-coffee/offers/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ price: 8 });
    expect(tooExpensive.status).toBe(400);

    const archived = await request(app)
      .delete(`/api/v1/admin/my-coffee/offers/${created.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(archived.status).toBe(200);
    const stored = await OfferModel.findById(created.id).lean().exec();
    expect(stored?.archivedAt).toBeTruthy();

    const restored = await request(app)
      .patch(`/api/v1/admin/my-coffee/offers/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ archived: false });
    expect(restored.status).toBe(200);
    expect(restored.body.data.status).toBe("ACTIVE");
    expect(restored.body.data.archivedAt).toBeNull();
  });

  it("rejects a price that is not a deal and items from another coffee", async () => {
    const items = await pricedItems();
    const token = await login();

    const notADeal = await request(app)
      .post("/api/v1/admin/my-coffee/offers")
      .set("Authorization", `Bearer ${token}`)
      .send(offerBody(items, { price: 8 }));
    expect(notADeal.status).toBe(400);

    const foreignItems = await pricedItems(OTHER_SLUG);
    const foreign = await request(app)
      .post("/api/v1/admin/my-coffee/offers")
      .set("Authorization", `Bearer ${token}`)
      .send(offerBody(foreignItems));
    expect(foreign.status).toBe(400);
  });

  it("scopes every mutation to the authenticated coffee", async () => {
    const items = await pricedItems();
    const created = await createOffer(await login(), offerBody(items));
    const otherToken = await login(OTHER_SLUG);

    const update = await request(app)
      .patch(`/api/v1/admin/my-coffee/offers/${created.id}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ name: "Hijacked" });
    expect(update.status).toBe(404);

    const archive = await request(app)
      .delete(`/api/v1/admin/my-coffee/offers/${created.id}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(archive.status).toBe(404);

    const stored = await OfferModel.findById(created.id).lean().exec();
    expect(stored?.name).toBe("Formule du jour");
    expect(stored?.archivedAt).toBeNull();
  });

  it("publishes only active, in-window, in-stock offers with available components", async () => {
    const items = await pricedItems();
    const token = await login();
    const created = await createOffer(token, offerBody(items));

    const featured = await request(app).get(`/api/v1/coffees/${SLUG}/offers`);
    expect(featured.status).toBe(200);
    const offers = featured.body.data as FeaturedOfferDto[];
    expect(offers.map((offer) => offer.id)).toEqual([created.id]);
    expect(offers[0]!.originalPrice).toBe(8);
    expect(offers[0]!.savings).toBe(1.5);
    expect(offers[0]!.lines).toHaveLength(2);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await createOffer(token, offerBody(items, { name: "Expirée", endAt: yesterday }));
    await createOffer(token, offerBody(items, { name: "Planifiée", startAt: tomorrow }));
    const stillOne = await request(app).get(`/api/v1/coffees/${SLUG}/offers`);
    expect((stillOne.body.data as FeaturedOfferDto[]).map((offer) => offer.id)).toEqual([created.id]);

    await ItemModel.updateOne({ _id: items[0]!._id }, { $set: { isAvailable: false } });
    const unavailable = await request(app).get(`/api/v1/coffees/${SLUG}/offers`);
    expect(unavailable.body.data as FeaturedOfferDto[]).toEqual([]);

    await ItemModel.updateOne({ _id: items[0]!._id }, { $set: { isAvailable: true } });
    await request(app).delete(`/api/v1/admin/my-coffee/offers/${created.id}`).set("Authorization", `Bearer ${token}`);
    const archived = await request(app).get(`/api/v1/coffees/${SLUG}/offers`);
    expect(archived.body.data as FeaturedOfferDto[]).toEqual([]);
  });

  it("sells an offer, snapshots its contents and decrements stock atomically", async () => {
    const items = await pricedItems();
    const token = await login();
    const offer = await createOffer(token, offerBody(items, { stock: 2 }));

    const order = await request(app)
      .post("/api/v1/orders")
      .send({ coffeeSlug: SLUG, tableNumber: 4, offers: [{ offerId: offer.id, quantity: 2 }] });
    expect(order.status).toBe(201);
    const dto = order.body.data as OrderDto;
    expect(dto.items).toEqual([]);
    expect(dto.total).toBe(13);
    expect(dto.offers[0]).toMatchObject({
      offerId: offer.id,
      name: "Formule du jour",
      quantity: 2,
      unitPrice: 6.5,
      subtotal: 13,
    });
    expect(dto.offers[0]!.lines).toHaveLength(2);
    expect(dto.offers[0]!.lines[0]!.name).toBe(items[0]!.name);

    expect((await OfferModel.findById(offer.id).lean().exec())?.stock).toBe(0);

    const soldOut = await request(app)
      .post("/api/v1/orders")
      .send({ coffeeSlug: SLUG, tableNumber: 4, offers: [{ offerId: offer.id, quantity: 1 }] });
    expect(soldOut.status).toBe(409);
    expect(soldOut.body.details).toMatchObject({ code: "OFFER_SOLD_OUT" });

    const featured = await request(app).get(`/api/v1/coffees/${SLUG}/offers`);
    expect(featured.body.data as FeaturedOfferDto[]).toEqual([]);
  });

  it("restores offer stock when a pending offer order is rejected", async () => {
    const items = await pricedItems();
    const token = await login();
    const offer = await createOffer(token, offerBody(items, { stock: 2 }));

    const order = await request(app)
      .post("/api/v1/orders")
      .send({ coffeeSlug: SLUG, tableNumber: 3, offers: [{ offerId: offer.id, quantity: 2 }] });
    expect(order.status).toBe(201);
    expect((await OfferModel.findById(offer.id).lean().exec())?.stock).toBe(0);

    const rejected = await request(app)
      .patch(`/api/v1/admin/my-coffee/orders/${order.body.data.id as string}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "REJECTED" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("REJECTED");
    expect((await OfferModel.findById(offer.id).lean().exec())?.stock).toBe(2);
  });

  it("mixes items and offers in one correctly totalled order", async () => {
    const items = await pricedItems();
    const token = await login();
    const offer = await createOffer(token, offerBody(items, { stock: 5 }));

    const order = await request(app)
      .post("/api/v1/orders")
      .send({
        coffeeSlug: SLUG,
        tableNumber: 6,
        items: [{ itemId: items[1]!._id.toString(), quantity: 1 }],
        offers: [{ offerId: offer.id, quantity: 1 }],
      });
    expect(order.status).toBe(201);
    const dto = order.body.data as OrderDto;
    expect(dto.items).toHaveLength(1);
    expect(dto.offers).toHaveLength(1);
    expect(dto.total).toBe(9.5);
  });

  it("refuses an offer whose component became unavailable, without touching stock", async () => {
    const items = await pricedItems();
    const token = await login();
    const offer = await createOffer(token, offerBody(items, { stock: 3 }));
    await ItemModel.updateOne({ _id: items[1]!._id }, { $set: { isAvailable: false } });

    const order = await request(app)
      .post("/api/v1/orders")
      .send({ coffeeSlug: SLUG, tableNumber: 2, offers: [{ offerId: offer.id, quantity: 1 }] });
    expect(order.status).toBe(409);
    expect(order.body.details).toMatchObject({ code: "OFFER_UNAVAILABLE" });
    expect((await OfferModel.findById(offer.id).lean().exec())?.stock).toBe(3);
  });

  it("detaches a deleted item from the offers that bundle it", async () => {
    const items = await pricedItems();
    const token = await login();
    const single = await request(app)
      .post("/api/v1/admin/my-coffee/offers")
      .set("Authorization", `Bearer ${token}`)
      .send(offerBody([items[0]!], { price: 4 }));
    expect(single.status).toBe(201);
    const offerId = single.body.data.id as string;

    const deleted = await request(app)
      .delete(`/api/v1/admin/my-coffee/items/${items[0]!._id.toString()}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleted.status).toBe(200);

    const stored = await OfferModel.findById(offerId).lean().exec();
    expect(stored?.lines).toEqual([]);
    expect(stored?.archivedAt).toBeTruthy();
  });

  it("validates the offer payload before it reaches the database", async () => {
    const items = await pricedItems();
    const token = await login();

    const duplicate = await request(app)
      .post("/api/v1/admin/my-coffee/offers")
      .set("Authorization", `Bearer ${token}`)
      .send(
        offerBody(items, {
          lines: [
            { itemId: items[0]!._id.toString(), quantity: 1 },
            { itemId: items[0]!._id.toString(), quantity: 2 },
          ],
        }),
      );
    expect(duplicate.status).toBe(400);

    const badWindow = await request(app)
      .post("/api/v1/admin/my-coffee/offers")
      .set("Authorization", `Bearer ${token}`)
      .send(
        offerBody(items, {
          startAt: new Date(Date.now() + 86_400_000).toISOString(),
          endAt: new Date(Date.now() - 86_400_000).toISOString(),
        }),
      );
    expect(badWindow.status).toBe(400);

    const emptyOrder = await request(app)
      .post("/api/v1/orders")
      .send({ coffeeSlug: SLUG, tableNumber: 3, items: [], offers: [] });
    expect(emptyOrder.status).toBe(400);
  });
});
