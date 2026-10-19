import { CoffeeModel } from "../models/coffee.model.js";
import { type Order, type OrderStatus, type PaymentStatus } from "../models/order.model.js";
import {
  createOrder,
  findMenuItemsForCoffee,
  findOrder,
  findOrderOwnedByCoffee,
  listOrders,
  markOrderPaid,
  updateOrderStatus,
} from "../repositories/order.repository.js";
import { findCurrentServiceShift } from "../repositories/service-shift.repository.js";
import {
  createTableSession,
  assignTableSessionToServiceShift,
  findActiveTableSession,
  findTableSessionByToken,
  generateSessionToken,
  hashSessionToken,
  touchTableSession,
} from "../repositories/table-session.repository.js";
import type { OrderDto } from "../types/order.js";
import { publishOrderCreated, publishOrderUpdated } from "../realtime/realtime.js";
import { ApiError } from "../utils/ApiError.js";
import { Types } from "mongoose";

const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CONFIRMED", "REJECTED"],
  CONFIRMED: [],
  REJECTED: [],
};

function dto(order: Order, sessionToken?: string): OrderDto {
  return {
    id: order._id.toString(),
    coffeeId: order.coffeeId.toString(),
    tableNumber: order.tableNumber,
    items: order.items.map((item) => ({ ...item, itemId: item.itemId.toString(), image: item.image ?? null })),
    total: order.total,
    status: order.status,
    paymentStatus: order.paymentStatus ?? "UNPAID",
    paidAt: order.paidAt ?? null,
    paidBy: order.paidBy ?? null,
    tableSessionId: order.tableSessionId?.toString() ?? null,
    serviceShiftId: order.serviceShiftId?.toString() ?? null,
    ...(sessionToken ? { sessionToken } : {}),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

async function resolveTableSession(coffeeId: Types.ObjectId, tableNumber: number, suppliedToken?: string) {
  const activeShift = await findCurrentServiceShift(coffeeId.toString());
  let session = suppliedToken ? await findTableSessionByToken(suppliedToken) : null;
  if (suppliedToken) {
    if (
      !session ||
      session.status !== "ACTIVE" ||
      session.coffeeId.toString() !== coffeeId.toString() ||
      session.tableNumber !== tableNumber
    ) {
      throw new ApiError(401, "Invalid or expired session token.");
    }
    return { session, sessionToken: suppliedToken, serviceShiftId: activeShift?._id ?? null };
  }

  session = await findActiveTableSession(coffeeId.toString(), tableNumber);
  if (!session) {
    const sessionToken = generateSessionToken();
    try {
      session = await createTableSession({
        coffeeId,
        tableNumber,
        serviceShiftId: activeShift?._id ?? null,
        sessionTokenHash: hashSessionToken(sessionToken),
      });
      return { session, sessionToken, serviceShiftId: activeShift?._id ?? null };
    } catch (error) {
      // The partial unique index is the synchronization primitive. A
      // concurrent first order wins; the loser adopts that active session.
      if (typeof error !== "object" || error === null || (error as { code?: number }).code !== 11000) throw error;
      session = await findActiveTableSession(coffeeId.toString(), tableNumber);
      if (!session) throw error;
    }
  }
  return { session, serviceShiftId: activeShift?._id ?? null };
}

export async function placeOrder(input: {
  coffeeSlug: string;
  tableNumber: number;
  items: { itemId: string; quantity: number }[];
  sessionToken?: string;
}): Promise<OrderDto> {
  const coffee = await CoffeeModel.findOne({ slug: input.coffeeSlug }).select({ _id: 1 }).lean().exec();
  if (!coffee) throw new ApiError(404, "Coffee not found");

  const menuItems = await findMenuItemsForCoffee(
    coffee._id.toString(),
    input.items.map((item) => item.itemId),
  );
  const byId = new Map(menuItems.map((item) => [item._id.toString(), item]));
  if (menuItems.length !== input.items.length)
    throw new ApiError(400, "One or more items do not belong to this coffee.");

  let subtotal = 0;
  const snapshots = input.items.map(({ itemId, quantity }) => {
    const item = byId.get(itemId);
    if (!item) throw new ApiError(400, "One or more items do not belong to this coffee.");
    if (item.isAvailable === false) throw new ApiError(409, `Item "${item.name}" is not available.`);
    const unitPrice = item.promotion ?? item.price;
    const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
    subtotal += lineTotal;
    return { itemId: item._id, name: item.name, image: item.image ?? null, quantity, unitPrice, subtotal: lineTotal };
  });
  subtotal = Math.round(subtotal * 100) / 100;
  const session = await resolveTableSession(coffee._id, input.tableNumber, input.sessionToken);
  if (session.serviceShiftId) {
    await assignTableSessionToServiceShift(coffee._id.toString(), session.session._id, session.serviceShiftId);
  }
  const order = await createOrder({
    coffeeId: coffee._id,
    tableNumber: input.tableNumber,
    items: snapshots,
    total: subtotal,
    status: "PENDING",
    tableSessionId: session.session._id,
    serviceShiftId: session.serviceShiftId,
  });
  await touchTableSession(session.session._id);
  const result = dto(order.toObject(), session.sessionToken);
  publishOrderCreated(result);
  return result;
}

export async function getCoffeeOrders(
  coffeeId: string,
  status?: OrderStatus,
  paymentStatus?: PaymentStatus,
  page = 1,
  limit = 50,
) {
  const result = await listOrders(coffeeId, status, paymentStatus, (page - 1) * limit, limit);
  return { orders: result.orders.map((order) => dto(order)), total: result.total, page, limit };
}

export async function getPublicOrder(orderId: string, sessionToken?: string) {
  const order = await findOrder(orderId);
  if (!order) throw new ApiError(404, "Order not found");
  if (order.tableSessionId && sessionToken) {
    const session = await findTableSessionByToken(sessionToken);
    if (!session || !order.tableSessionId || session._id.toString() !== order.tableSessionId.toString()) {
      throw new ApiError(401, "Invalid session token.");
    }
  }
  return dto(order);
}

export async function getCoffeeOrder(coffeeId: string, orderId: string) {
  const order = await findOrderOwnedByCoffee(coffeeId, orderId);
  if (!order) throw new ApiError(404, "Order not found");
  return dto(order);
}

export async function changeOrderStatus(coffeeId: string, orderId: string, nextStatus: OrderStatus) {
  const current = await findOrderOwnedByCoffee(coffeeId, orderId);
  if (!current) throw new ApiError(404, "Order not found");
  if (!transitions[current.status as OrderStatus].includes(nextStatus)) {
    throw new ApiError(409, `Cannot change order status from ${current.status} to ${nextStatus}.`);
  }
  const activeService = nextStatus === "CONFIRMED" ? await findCurrentServiceShift(coffeeId) : null;
  if (nextStatus === "CONFIRMED" && !activeService) {
    throw new ApiError(409, "An active service is required before confirming orders.", {
      code: "NO_ACTIVE_SERVICE",
    });
  }
  const updated = await updateOrderStatus(coffeeId, orderId, nextStatus, new Date(), activeService?._id);
  if (!updated) throw new ApiError(404, "Order not found");
  if (nextStatus === "CONFIRMED" && activeService && current.tableSessionId) {
    await assignTableSessionToServiceShift(coffeeId, current.tableSessionId, activeService._id);
  }
  const result = dto(updated);
  publishOrderUpdated(result);
  return result;
}

export async function validateOrderPayment(coffeeId: string, orderId: string, paidBy: string) {
  const current = await findOrderOwnedByCoffee(coffeeId, orderId);
  if (!current) throw new ApiError(404, "Order not found");
  if (current.status !== "CONFIRMED") throw new ApiError(409, "Only confirmed orders can be marked as paid.");
  if (current.paymentStatus === "PAID") throw new ApiError(409, "Order payment is already validated.");
  const updated = await markOrderPaid(coffeeId, orderId, new Date(), paidBy);
  if (!updated) throw new ApiError(409, "Order payment was already validated or is no longer eligible.");
  const result = dto(updated);
  publishOrderUpdated(result);
  return result;
}
