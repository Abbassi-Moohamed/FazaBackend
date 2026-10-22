import { Types } from "mongoose";
import {
  closeTableSession,
  getTableSessionSummary,
  listTableSessions,
} from "../repositories/table-session.repository.js";
import {
  closeServiceShift,
  createServiceShift,
  findCurrentServiceShift,
  findServiceShiftOwnedByCoffee,
  getServiceShiftSummary,
  listServiceShifts,
} from "../repositories/service-shift.repository.js";
import type { ServiceShiftStatus, ServiceShiftType } from "../models/service-shift.model.js";
import type { TableSessionStatus } from "../models/table-session.model.js";
import type { ServiceShiftDto, TableSessionDto, TableSessionTotals } from "../types/service-shift.js";
import { ApiError } from "../utils/ApiError.js";

interface ServiceShiftDoc {
  _id: Types.ObjectId;
  coffeeId: Types.ObjectId;
  status: ServiceShiftStatus;
  name?: string | null;
  type?: ServiceShiftType;
  label?: string | null;
  notes?: string | null;
  openedAt: Date;
  closedAt?: Date | null;
}

interface TableSessionDoc {
  _id: Types.ObjectId;
  coffeeId: Types.ObjectId;
  tableNumber: number;
  serviceShiftId?: Types.ObjectId | null;
  status: TableSessionStatus;
  openedAt: Date;
  closedAt?: Date | null;
  lastOrderAt: Date;
  orderCount: number;
}

interface SessionOrderRow {
  _id: Types.ObjectId;
  tableNumber: number;
  status: string;
  paymentStatus?: string;
  total: number;
}

interface TableSessionSummaryDoc extends TableSessionDoc {
  orders?: SessionOrderRow[];
}

interface SessionOrderSummaryRow {
  _id?: { status?: string; paymentStatus?: string };
  count?: number;
  revenue?: number;
}

interface TableSessionListRow extends TableSessionDoc {
  orderSummary?: SessionOrderSummaryRow[];
}

function shiftDto(shift: ServiceShiftDoc, summary?: unknown): ServiceShiftDto {
  return {
    id: shift._id.toString(),
    coffeeId: shift.coffeeId.toString(),
    status: shift.status,
    name: shift.name ?? shift.label ?? null,
    type: shift.type ?? "CUSTOM",
    label: shift.label ?? null,
    notes: shift.notes ?? null,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt ?? null,
    ...(summary !== undefined ? { summary } : {}),
  };
}

function sessionDto(session: TableSessionDoc, summary?: unknown, totals?: TableSessionTotals): TableSessionDto {
  return {
    id: session._id.toString(),
    coffeeId: session.coffeeId.toString(),
    tableNumber: session.tableNumber,
    serviceShiftId: session.serviceShiftId?.toString() ?? null,
    status: session.status,
    openedAt: session.openedAt,
    closedAt: session.closedAt ?? null,
    lastOrderAt: session.lastOrderAt,
    orderCount: session.orderCount,
    ...(summary !== undefined ? { summary } : {}),
    ...(totals !== undefined ? { totals } : {}),
  };
}

/**
 * Bill of a session, aggregated by the database over its orders.
 *
 * The list of sessions is the backoffice's source of truth for the bills:
 * computing them here keeps them exact even when the session holds more
 * orders than a paginated order list could ever return.
 */
function sessionTotalsDto(session: TableSessionListRow): TableSessionTotals {
  const rows = Array.isArray(session.orderSummary) ? session.orderSummary : [];
  const count = (predicate: (row: SessionOrderSummaryRow) => boolean) =>
    rows.filter(predicate).reduce((total, row) => total + Number(row.count ?? 0), 0);
  const revenue = (predicate: (row: SessionOrderSummaryRow) => boolean) =>
    rows.filter(predicate).reduce((total, row) => total + Number(row.revenue ?? 0), 0);

  const withStatus = (status: string) => (row: SessionOrderSummaryRow) => row._id?.status === status;
  const isConfirmed = withStatus("CONFIRMED");
  const isPaid = (row: SessionOrderSummaryRow) => row._id?.paymentStatus === "PAID";

  return {
    totalOrders: count(() => true),
    confirmedOrders: count(isConfirmed),
    pendingOrders: count(withStatus("PENDING")),
    rejectedOrders: count(withStatus("REJECTED")),
    confirmedRevenue: revenue(isConfirmed),
    paidRevenue: revenue((row) => isConfirmed(row) && isPaid(row)),
    outstandingRevenue: revenue((row) => isConfirmed(row) && !isPaid(row)),
    pendingRevenue: revenue(withStatus("PENDING")),
  };
}

function paymentOrderDto(order: SessionOrderRow) {
  return {
    id: order._id.toString(),
    tableNumber: order.tableNumber,
    status: order.status,
    paymentStatus: order.paymentStatus ?? "UNPAID",
    total: order.total,
  };
}

function sessionSummaryDto(summary: TableSessionSummaryDoc | null) {
  if (!summary) return summary;
  return {
    ...summary,
    orders: Array.isArray(summary.orders) ? summary.orders.map(paymentOrderDto) : [],
  };
}

export async function getCurrentServiceShift(coffeeId: string): Promise<ServiceShiftDto | null> {
  const shift = await findCurrentServiceShift(coffeeId);
  return shift ? shiftDto(shift, await getServiceShiftSummary(coffeeId, shift._id.toString())) : null;
}

export async function openServiceShift(
  coffeeId: string,
  input: { name?: string; type?: "MORNING" | "AFTERNOON" | "CUSTOM"; label?: string; notes?: string },
): Promise<ServiceShiftDto> {
  const current = await findCurrentServiceShift(coffeeId);
  if (current) throw new ApiError(409, "A service shift is already open.");
  try {
    const shift = await createServiceShift({
      coffeeId: new Types.ObjectId(coffeeId),
      status: "OPEN",
      name: input.name ?? input.label ?? null,
      type: input.type ?? "CUSTOM",
      label: input.label ?? null,
      notes: input.notes ?? null,
      openedByRole: "COFFEE_ADMIN",
    });
    return shiftDto(shift);
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: number }).code === 11000) {
      throw new ApiError(409, "A service shift is already open.");
    }
    throw error;
  }
}

export async function getServiceShifts(coffeeId: string, status?: "OPEN" | "CLOSED", page = 1, limit = 50) {
  const result = await listServiceShifts(coffeeId, status, (page - 1) * limit, limit);
  return {
    shifts: result.shifts.map((shift) => shiftDto(shift, (shift as { summary?: unknown }).summary)),
    total: result.total,
    page,
    limit,
  };
}

export async function getServiceShift(coffeeId: string, shiftId: string): Promise<ServiceShiftDto> {
  const shift = await findServiceShiftOwnedByCoffee(coffeeId, shiftId);
  if (!shift) throw new ApiError(404, "Service shift not found.");
  return shiftDto(shift, await getServiceShiftSummary(coffeeId, shiftId));
}

export async function finishServiceShift(coffeeId: string, shiftId: string): Promise<ServiceShiftDto> {
  const existing = await findServiceShiftOwnedByCoffee(coffeeId, shiftId);
  if (!existing) throw new ApiError(404, "Service shift not found.");
  if (existing.status !== "OPEN") {
    throw new ApiError(409, "Service shift is already closed.");
  }

  const openTables = await listTableSessions(coffeeId, {
    serviceShiftId: shiftId,
    status: "ACTIVE",
    limit: 1000,
  });
  if (openTables.total > 0) {
    // The admin settles tables, not sessions: the open sessions are grouped
    // by table before being reported back.
    const byTable = new Map<number, { orders: number; revenue: number }>();
    for (const session of openTables.sessions as TableSessionListRow[]) {
      const totals = sessionTotalsDto(session);
      const current = byTable.get(session.tableNumber) ?? { orders: 0, revenue: 0 };
      byTable.set(session.tableNumber, {
        orders: current.orders + totals.totalOrders,
        revenue: current.revenue + totals.confirmedRevenue,
      });
    }
    throw new ApiError(409, "Some tables must be closed before closing the service.", {
      code: "OPEN_TABLES_REMAIN",
      tables: Array.from(byTable.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([tableNumber, totals]) => ({ tableNumber, orders: totals.orders, revenue: totals.revenue })),
    });
  }

  const closed = await closeServiceShift(coffeeId, shiftId);
  if (!closed) {
    throw new ApiError(409, "Service shift is already closed.");
  }
  return shiftDto(closed, await getServiceShiftSummary(coffeeId, shiftId));
}

export async function finishCurrentServiceShift(coffeeId: string): Promise<ServiceShiftDto> {
  const current = await findCurrentServiceShift(coffeeId);
  if (!current) throw new ApiError(404, "No open service shift.");
  return finishServiceShift(coffeeId, current._id.toString());
}

export async function getCoffeeTableSessions(
  coffeeId: string,
  options: { serviceShiftId?: string; status?: "ACTIVE" | "CLOSED"; page?: number; limit?: number } = {},
) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const result = await listTableSessions(coffeeId, { ...options, skip: (page - 1) * limit, limit });
  return {
    sessions: result.sessions.map((session) => sessionDto(session, undefined, sessionTotalsDto(session))),
    total: result.total,
    page,
    limit,
  };
}

export async function getCoffeeTableSession(coffeeId: string, sessionId: string): Promise<TableSessionDto> {
  const summary = await getTableSessionSummary(coffeeId, sessionId);
  if (!summary) throw new ApiError(404, "Table session not found.");
  return sessionDto(summary, sessionSummaryDto(summary));
}

export async function finishTableSession(coffeeId: string, sessionId: string): Promise<TableSessionDto> {
  const current = await getTableSessionSummary(coffeeId, sessionId);
  if (!current) throw new ApiError(404, "Table session not found.");
  if (current.status !== "ACTIVE") {
    return sessionDto(current, sessionSummaryDto(current));
  }
  const orders = Array.isArray(current.orders) ? (current.orders as SessionOrderRow[]) : [];
  const unpaidOrders = orders.filter((order) => order.status === "CONFIRMED" && order.paymentStatus !== "PAID");
  const pendingOrders = orders.filter((order) => order.status === "PENDING");
  if (pendingOrders.length > 0) {
    throw new ApiError(409, "Table has pending orders.", {
      code: "TABLE_PENDING_ORDERS",
      orders: pendingOrders.map(paymentOrderDto),
    });
  }
  if (unpaidOrders.length > 0) {
    throw new ApiError(409, "Table has unpaid confirmed orders.", {
      code: "TABLE_UNPAID_ORDERS",
      orders: unpaidOrders.map(paymentOrderDto),
    });
  }
  const closed = await closeTableSession(coffeeId, sessionId);
  if (!closed) {
    const existing = await getTableSessionSummary(coffeeId, sessionId);
    if (!existing) throw new ApiError(404, "Table session not found.");
    // Closing is intentionally idempotent. A stale dashboard or a retried
    // request should receive the closed session state rather than an
    // operational conflict.
    return sessionDto(existing, sessionSummaryDto(existing));
  }
  const summary = await getTableSessionSummary(coffeeId, sessionId);
  return sessionDto(closed, summary ? sessionSummaryDto(summary) : undefined);
}
