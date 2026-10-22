import type { OrderStatus, PaymentStatus } from "../models/order.model.js";
import {
  closeCoffeeTableSessions,
  listCoffeeTable,
  listCoffeeTables,
  type CoffeeTableRow,
  type TableOrderDoc,
} from "../repositories/table.repository.js";
import type {
  AdminTableCloseDto,
  AdminTableDto,
  AdminTableListDto,
  AdminTableOrderDto,
  AdminTableTotals,
} from "../types/table.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Table-centric operations for the coffee backoffice.
 *
 * The admin never sees a client session: it sees tables, their orders and
 * their bill. A table can host several sessions (one per party) and is
 * settled as a whole.
 */

function isConfirmed(order: TableOrderDoc): boolean {
  return order.status === "CONFIRMED";
}

function isPaid(order: TableOrderDoc): boolean {
  return order.paymentStatus === "PAID";
}

/** Bill of a table, computed over every order it holds. */
export function tableTotals(orders: TableOrderDoc[]): AdminTableTotals {
  const sum = (predicate: (order: TableOrderDoc) => boolean) =>
    orders.filter(predicate).reduce((total, order) => total + Number(order.total ?? 0), 0);

  return {
    totalOrders: orders.length,
    confirmedOrders: orders.filter(isConfirmed).length,
    pendingOrders: orders.filter((order) => order.status === "PENDING").length,
    rejectedOrders: orders.filter((order) => order.status === "REJECTED").length,
    confirmedRevenue: sum(isConfirmed),
    paidRevenue: sum((order) => isConfirmed(order) && isPaid(order)),
    outstandingRevenue: sum((order) => isConfirmed(order) && !isPaid(order)),
    pendingRevenue: sum((order) => order.status === "PENDING"),
  };
}

function tableOrderDto(order: TableOrderDoc, tableNumber: number): AdminTableOrderDto {
  return {
    id: order._id.toString(),
    tableNumber,
    status: order.status as OrderStatus,
    paymentStatus: (order.paymentStatus ?? "UNPAID") as PaymentStatus,
    total: Number(order.total ?? 0),
    createdAt: new Date(order.createdAt).toISOString(),
    paidAt: order.paidAt ? new Date(order.paidAt).toISOString() : null,
    items: (order.items ?? []).map((item) => ({ name: item.name, quantity: item.quantity })),
  };
}

function tableDto(row: CoffeeTableRow): AdminTableDto {
  const orders = [...row.orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return {
    tableNumber: row.tableNumber,
    sessions: row.sessionIds.length,
    openedAt: new Date(row.openedAt).toISOString(),
    lastOrderAt: new Date(row.lastOrderAt).toISOString(),
    totals: tableTotals(orders),
    orders: orders.map((order) => tableOrderDto(order, row.tableNumber)),
  };
}

/** Every table currently open in the coffee, with its orders and its bill. */
export async function getCoffeeTables(coffeeId: string): Promise<AdminTableListDto> {
  const tables = (await listCoffeeTables(coffeeId)).map(tableDto);
  return { tables, total: tables.length };
}

/**
 * Close a table: every session running on it is closed at once.
 *
 * A table can only be closed once its orders are settled — the pending and
 * the unpaid ones are reported back so the admin can settle them first.
 */
export async function closeCoffeeTable(coffeeId: string, tableNumber: number): Promise<AdminTableCloseDto> {
  const row = await listCoffeeTable(coffeeId, tableNumber);
  if (!row) throw new ApiError(404, "Table not found.");

  const pending = row.orders.filter((order) => order.status === "PENDING");
  if (pending.length > 0) {
    throw new ApiError(409, "Table has pending orders.", {
      code: "TABLE_PENDING_ORDERS",
      orders: pending.map((order) => tableOrderDto(order, tableNumber)),
    });
  }
  const unpaid = row.orders.filter((order) => isConfirmed(order) && !isPaid(order));
  if (unpaid.length > 0) {
    throw new ApiError(409, "Table has unpaid confirmed orders.", {
      code: "TABLE_UNPAID_ORDERS",
      orders: unpaid.map((order) => tableOrderDto(order, tableNumber)),
    });
  }

  const closedSessions = await closeCoffeeTableSessions(coffeeId, tableNumber);
  return { tableNumber, closedSessions, totals: tableTotals(row.orders) };
}
