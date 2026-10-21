import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as clientIo, type Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../src/app.js";
import { issueAdminToken } from "../src/auth/token.js";
import { seedDatabase } from "../src/db/seed.js";
import { CoffeeModel } from "../src/models/coffee.model.js";
import { ItemCategoryModel } from "../src/models/item-category.model.js";
import { ItemModel } from "../src/models/item.model.js";
import { initRealtime, closeRealtime } from "../src/realtime/realtime.js";
import { changeOrderStatus } from "../src/services/order.service.js";
import { openServiceShift } from "../src/services/service-shift.service.js";
import { setupTestDatabase, teardownTestDatabase, type TestDatabase } from "./helpers.js";

interface OrderEventPayload {
  id: string;
  status: string;
  paymentStatus: string;
  total: number;
  tableNumber: number;
  sessionToken?: string;
}

function connectClient(url: string, auth?: Record<string, unknown>): Promise<ClientSocket> {
  const socket = clientIo(url, { auth, transports: ["websocket"], reconnection: false });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function expectEvent(socket: ClientSocket, event: string, timeoutMs = 3_000): Promise<OrderEventPayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload: OrderEventPayload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Subscribes to an order room and resolves only once the server confirms the join. */
function subscribeToOrder(socket: ClientSocket, orderId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for subscribe ack")), 3_000);
    socket.emit("order:subscribe", orderId, (result: { joined: boolean }) => {
      clearTimeout(timer);
      if (result.joined) resolve();
      else reject(new Error("Server refused the order subscription"));
    });
  });
}

/** Subscribes to a table session room with the session token as proof of ownership. */
function subscribeToSession(socket: ClientSocket, sessionToken: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for session subscribe ack")), 3_000);
    socket.emit("session:subscribe", sessionToken, (result: { joined: boolean }) => {
      clearTimeout(timer);
      if (result.joined) resolve();
      else reject(new Error("Server refused the session subscription"));
    });
  });
}

describe("realtime order events", () => {
  let database: TestDatabase;
  let httpServer: HttpServer;
  let app: ReturnType<typeof createApp>;
  let url: string;
  let coffeeId: string;
  let itemId: string;

  beforeAll(async () => {
    database = await setupTestDatabase();
    app = createApp();
    httpServer = createServer(app);
    initRealtime(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await seedDatabase();
    const coffee = await CoffeeModel.findOne({ slug: "cafe-el-manzah" }).lean().exec();
    coffeeId = coffee!._id.toString();
    const categoryIds = await ItemCategoryModel.find({ coffeeId: coffee!._id }).distinct("_id").exec();
    const item = await ItemModel.findOne({ itemCategoryId: { $in: categoryIds } })
      .lean()
      .exec();
    itemId = item!._id.toString();
  });

  afterAll(async () => {
    closeRealtime();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await teardownTestDatabase(database);
  });

  async function placeTestOrder(tableNumber: number): Promise<OrderEventPayload> {
    const response = await request(app)
      .post("/api/v1/orders")
      .send({ coffeeSlug: "cafe-el-manzah", tableNumber, items: [{ itemId, quantity: 1 }] });
    expect(response.status).toBe(201);
    return response.body.data as OrderEventPayload;
  }

  it("pushes order:new to coffee admins and order:updated to subscribed customers", async () => {
    const adminToken = await issueAdminToken({ role: "COFFEE_ADMIN", coffeeId });
    const admin = await connectClient(url, { token: adminToken });
    const customer = await connectClient(url);

    const newOrderReceived = expectEvent(admin, "order:new");
    const placed = await placeTestOrder(21);
    const newOrder = await newOrderReceived;
    expect(newOrder.id).toBe(placed.id);
    expect(newOrder.status).toBe("PENDING");
    // The ordering client's session token must never leak to admins.
    expect(newOrder.sessionToken).toBeUndefined();

    await subscribeToOrder(customer, placed.id);

    const updatedReceived = expectEvent(customer, "order:updated");
    await openServiceShift(coffeeId, { type: "MORNING" });
    await changeOrderStatus(coffeeId, placed.id, "CONFIRMED");
    const updated = await updatedReceived;
    expect(updated.id).toBe(placed.id);
    expect(updated.status).toBe("CONFIRMED");

    admin.disconnect();
    customer.disconnect();
  });

  it("pushes order updates to a customer subscribed to its table session", async () => {
    const adminToken = await issueAdminToken({ role: "COFFEE_ADMIN", coffeeId });
    const admin = await connectClient(url, { token: adminToken });
    const customer = await connectClient(url);

    const placed = await placeTestOrder(23);
    await subscribeToSession(customer, placed.sessionToken!);

    const updatedReceived = expectEvent(customer, "order:updated");
    await openServiceShift(coffeeId, { type: "MORNING" });
    await changeOrderStatus(coffeeId, placed.id, "CONFIRMED");
    const updated = await updatedReceived;
    expect(updated.id).toBe(placed.id);
    expect(updated.status).toBe("CONFIRMED");

    admin.disconnect();
    customer.disconnect();
  });

  it("refuses a session subscription without a valid session token", async () => {
    const customer = await connectClient(url);
    const result = await new Promise<{ joined: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for session ack")), 3_000);
      customer.emit("session:subscribe", "not-a-real-session-token", (ack: { joined: boolean }) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
    expect(result.joined).toBe(false);
    customer.disconnect();
  });

  it("does not deliver order:new to admins of a different coffee", async () => {
    const otherCoffee = await CoffeeModel.findOne({ slug: "brew-and-beans" }).lean().exec();
    const otherToken = await issueAdminToken({ role: "COFFEE_ADMIN", coffeeId: otherCoffee!._id.toString() });
    const otherAdmin = await connectClient(url, { token: otherToken });

    let received = false;
    otherAdmin.on("order:new", () => {
      received = true;
    });

    await placeTestOrder(22);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toBe(false);

    otherAdmin.disconnect();
  });

  it("rejects sockets that present an invalid admin token", async () => {
    await expect(connectClient(url, { token: "not-a-valid-token" })).rejects.toThrow("unauthorized");
  });
});
