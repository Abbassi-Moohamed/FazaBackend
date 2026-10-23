import { CoffeeModel } from "../models/coffee.model.js";
import { type Order, type OrderStatus, type PaymentStatus } from "../models/order.model.js";
import {
  createOrder,
  findMenuItemsForCoffee,
  findOrder,
  findOrderOwnedByCoffee,
  listOrders,
  listOrdersByTableSession,
  markOrderPaid,
  updateOrderStatus,
} from "../repositories/order.repository.js";
import { findCurrentServiceShift } from "../repositories/service-shift.repository.js";
import {
  consumeOfferStock,
  findItemsForOfferLines,
  findPurchasableOffer,
  restoreOfferStock,
  type OfferRow,
} from "../repositories/offer.repository.js";
import {
  createTableSession,
  assignTableSessionToServiceShift,
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
    offers: (order.offers ?? []).map((offer) => ({
      offerId: offer.offerId.toString(),
      name: offer.name,
      image: offer.image ?? null,
      quantity: offer.quantity,
      unitPrice: offer.unitPrice,
      subtotal: offer.subtotal,
      lines: (offer.lines ?? []).map((line) => ({ name: line.name, quantity: line.quantity })),
    })),
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
  if (suppliedToken) {
    const session = await findTableSessionByToken(suppliedToken);
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

  // No token: this device starts its own session. A table can host several
  // concurrent sessions (different parties sharing a table), so an existing
  // session is never adopted — that would merge two customers' bills.
  const sessionToken = generateSessionToken();
  const session = await createTableSession({
    coffeeId,
    tableNumber,
    serviceShiftId: activeShift?._id ?? null,
    sessionTokenHash: hashSessionToken(sessionToken),
  });
  return { session, sessionToken, serviceShiftId: activeShift?._id ?? null };
}

interface ItemSnapshot {
  itemId: Types.ObjectId;
  name: string;
  image: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

interface OfferSnapshot {
  offerId: Types.ObjectId;
  name: string;
  image: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  lines: { name: string; quantity: number }[];
}

interface ReservedStock {
  offerId: Types.ObjectId;
  quantity: number;
}

async function releaseReservedStock(reserved: ReservedStock[]): Promise<void> {
  await Promise.allSettled(reserved.map((entry) => restoreOfferStock(entry.offerId, entry.quantity)));
}

export async function placeOrder(input: {
  coffeeSlug: string;
  tableNumber: number;
  items: { itemId: string; quantity: number }[];
  offers?: { offerId: string; quantity: number }[];
  sessionToken?: string;
}): Promise<OrderDto> {
  const coffee = await CoffeeModel.findOne({ slug: input.coffeeSlug }).select({ _id: 1 }).lean().exec();
  if (!coffee) throw new ApiError(404, "Coffee not found");
  const coffeeId = coffee._id.toString();
  const now = new Date();

  let itemsSubtotal = 0;
  const itemSnapshots: ItemSnapshot[] = [];
  if (input.items.length > 0) {
    const menuItems = await findMenuItemsForCoffee(
      coffeeId,
      input.items.map((item) => item.itemId),
    );
    const byId = new Map(menuItems.map((item) => [item._id.toString(), item]));
    if (menuItems.length !== input.items.length)
      throw new ApiError(400, "One or more items do not belong to this coffee.");

    for (const { itemId, quantity } of input.items) {
      const item = byId.get(itemId);
      if (!item) throw new ApiError(400, "One or more items do not belong to this coffee.");
      if (item.isAvailable === false) throw new ApiError(409, `Item "${item.name}" is not available.`);
      const unitPrice = item.promotion ?? item.price;
      const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
      itemsSubtotal += lineTotal;
      itemSnapshots.push({
        itemId: item._id,
        name: item.name,
        image: item.image ?? null,
        quantity,
        unitPrice,
        subtotal: lineTotal,
      });
    }
    itemsSubtotal = Math.round(itemsSubtotal * 100) / 100;
  }

  // Offers are fully validated (window, active, components available) before
  // any stock is reserved, so a stale basket fails without side effects.
  const requestedOffers = input.offers ?? [];
  const offerSnapshots: OfferSnapshot[] = [];
  let offersSubtotal = 0;
  if (requestedOffers.length > 0) {
    const resolved: { offer: OfferRow; quantity: number }[] = [];
    for (const entry of requestedOffers) {
      const offer = await findPurchasableOffer(coffeeId, entry.offerId, now);
      if (!offer) {
        throw new ApiError(409, "One or more offers are no longer available.", { code: "OFFER_UNAVAILABLE" });
      }
      resolved.push({ offer, quantity: entry.quantity });
    }

    const componentItems = await findItemsForOfferLines(
      coffeeId,
      resolved.flatMap(({ offer }) => offer.lines.map((line) => line.itemId.toString())),
    );
    const componentById = new Map(componentItems.map((item) => [item._id.toString(), item]));

    for (const { offer, quantity } of resolved) {
      if (offer.stock < quantity) {
        throw new ApiError(409, `Offer "${offer.name}" is out of stock.`, { code: "OFFER_SOLD_OUT" });
      }
      const lines = offer.lines.map((line) => {
        const component = componentById.get(line.itemId.toString());
        if (!component || component.isAvailable === false) {
          throw new ApiError(409, `Offer "${offer.name}" is no longer available.`, {
            code: "OFFER_UNAVAILABLE",
          });
        }
        return { name: component.name, quantity: line.quantity };
      });
      const subtotal = Math.round(offer.price * quantity * 100) / 100;
      offersSubtotal += subtotal;
      offerSnapshots.push({
        offerId: offer._id,
        name: offer.name,
        image: offer.image ?? null,
        quantity,
        unitPrice: offer.price,
        subtotal,
        lines,
      });
    }
    offersSubtotal = Math.round(offersSubtotal * 100) / 100;
  }

  const total = Math.round((itemsSubtotal + offersSubtotal) * 100) / 100;
  const session = await resolveTableSession(coffee._id, input.tableNumber, input.sessionToken);
  if (session.serviceShiftId) {
    await assignTableSessionToServiceShift(coffeeId, session.session._id, session.serviceShiftId);
  }

  // Reserve the bundles atomically, one by one. Without MongoDB transactions
  // (standalone deployments), a failed reservation restores everything already
  // taken; the same compensation runs if the order write fails afterwards.
  const reserved: ReservedStock[] = [];
  for (const snapshot of offerSnapshots) {
    const updated = await consumeOfferStock(coffeeId, snapshot.offerId.toString(), snapshot.quantity, now);
    if (!updated) {
      await releaseReservedStock(reserved);
      throw new ApiError(409, `Offer "${snapshot.name}" is out of stock.`, { code: "OFFER_SOLD_OUT" });
    }
    reserved.push({ offerId: snapshot.offerId, quantity: snapshot.quantity });
  }

  let order: Awaited<ReturnType<typeof createOrder>>;
  try {
    order = await createOrder({
      coffeeId: coffee._id,
      tableNumber: input.tableNumber,
      items: itemSnapshots,
      offers: offerSnapshots,
      total,
      status: "PENDING",
      tableSessionId: session.session._id,
      serviceShiftId: session.serviceShiftId,
    });
  } catch (error) {
    await releaseReservedStock(reserved);
    throw error;
  }

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

/**
 * Every order placed by one table session, newest first. The session token is
 * the only credential: it proves the caller owns the session, so the list is
 * scoped to a single party even when several sessions share a table.
 */
export async function getSessionOrders(sessionToken: string | undefined, limit = 50) {
  if (!sessionToken) throw new ApiError(401, "Session token is required.");
  const session = await findTableSessionByToken(sessionToken);
  if (!session) throw new ApiError(401, "Invalid session token.");
  const result = await listOrdersByTableSession(session._id.toString(), limit);
  return {
    orders: result.orders.map((order) => dto(order)),
    total: result.total,
    session: {
      tableNumber: session.tableNumber,
      status: session.status,
      orderCount: session.orderCount,
      openedAt: session.openedAt,
      closedAt: session.closedAt ?? null,
    },
  };
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
  // Rejecting a pending order releases the bundles it had reserved.
  if (nextStatus === "REJECTED" && current.offers?.length) {
    await releaseReservedStock(current.offers.map((offer) => ({ offerId: offer.offerId, quantity: offer.quantity })));
  }
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
