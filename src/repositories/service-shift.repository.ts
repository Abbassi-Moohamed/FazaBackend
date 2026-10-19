import { Types } from "mongoose";
import { ServiceShiftModel, type ServiceShiftStatus } from "../models/service-shift.model.js";
import { OrderModel } from "../models/order.model.js";
import { TableSessionModel } from "../models/table-session.model.js";

export async function findCurrentServiceShift(coffeeId: string) {
  if (!Types.ObjectId.isValid(coffeeId)) return null;
  return ServiceShiftModel.findOne({ coffeeId, status: "OPEN" }).sort({ openedAt: -1 }).lean().exec();
}

export async function createServiceShift(input: Record<string, unknown>) {
  return ServiceShiftModel.create(input);
}

export async function listServiceShifts(coffeeId: string, status?: ServiceShiftStatus, skip = 0, limit = 50) {
  if (!Types.ObjectId.isValid(coffeeId)) return { shifts: [], total: 0 };
  const filter = { coffeeId: new Types.ObjectId(coffeeId), ...(status ? { status } : {}) };
  const [shifts, total] = await Promise.all([
    ServiceShiftModel.find(filter).sort({ openedAt: -1 }).skip(skip).limit(limit).lean().exec(),
    ServiceShiftModel.countDocuments(filter).exec(),
  ]);
  const shiftIds = shifts.map((shift) => shift._id);
  if (shiftIds.length === 0) return { shifts, total };

  const [orderSummaries, tableSummaries] = await Promise.all([
    OrderModel.aggregate([
      { $match: { coffeeId: new Types.ObjectId(coffeeId), serviceShiftId: { $in: shiftIds } } },
      {
        $group: {
          _id: "$serviceShiftId",
          ordersCount: { $sum: 1 },
          paidOrdersCount: {
            $sum: { $cond: [{ $and: [{ $eq: ["$status", "CONFIRMED"] }, { $eq: ["$paymentStatus", "PAID"] }] }, 1, 0] },
          },
          paidRevenue: {
            $sum: {
              $cond: [{ $and: [{ $eq: ["$status", "CONFIRMED"] }, { $eq: ["$paymentStatus", "PAID"] }] }, "$total", 0],
            },
          },
          itemsSold: {
            $sum: {
              $cond: [
                { $eq: ["$status", "CONFIRMED"] },
                {
                  $reduce: {
                    input: "$items",
                    initialValue: 0,
                    in: { $add: ["$$value", "$$this.quantity"] },
                  },
                },
                0,
              ],
            },
          },
        },
      },
    ]).exec(),
    TableSessionModel.aggregate([
      { $match: { coffeeId: new Types.ObjectId(coffeeId), serviceShiftId: { $in: shiftIds } } },
      { $group: { _id: "$serviceShiftId", tablesCount: { $sum: 1 } } },
    ]).exec(),
  ]);

  const orderByShift = new Map(orderSummaries.map((summary) => [summary._id.toString(), summary]));
  const tablesByShift = new Map(tableSummaries.map((summary) => [summary._id.toString(), summary]));
  return {
    shifts: shifts.map((shift) => ({
      ...shift,
      summary: {
        totalOrders: Number(orderByShift.get(shift._id.toString())?.ordersCount ?? 0),
        paidOrders: Number(orderByShift.get(shift._id.toString())?.paidOrdersCount ?? 0),
        paidRevenue: Number(orderByShift.get(shift._id.toString())?.paidRevenue ?? 0),
        itemsSold: Number(orderByShift.get(shift._id.toString())?.itemsSold ?? 0),
        tablesServed: Number(tablesByShift.get(shift._id.toString())?.tablesCount ?? 0),
      },
    })),
    total,
  };
}

export async function findServiceShiftOwnedByCoffee(coffeeId: string, shiftId: string) {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(shiftId)) return null;
  return ServiceShiftModel.findOne({ _id: shiftId, coffeeId }).lean().exec();
}

export async function closeServiceShift(coffeeId: string, shiftId: string, closedByRole = "COFFEE_ADMIN") {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(shiftId)) return null;
  return ServiceShiftModel.findOneAndUpdate(
    { _id: shiftId, coffeeId, status: "OPEN" },
    { $set: { status: "CLOSED", closedAt: new Date(), closedByRole } },
    { returnDocument: "after", runValidators: true },
  )
    .lean()
    .exec();
}

export async function getServiceShiftSummary(coffeeId: string, shiftId: string) {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(shiftId)) return null;
  const [summary] = await OrderModel.aggregate([
    { $match: { coffeeId: new Types.ObjectId(coffeeId), serviceShiftId: new Types.ObjectId(shiftId) } },
    {
      $facet: {
        statuses: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        confirmed: [
          { $match: { status: "CONFIRMED" } },
          { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
        ],
        paid: [
          { $match: { status: "CONFIRMED", paymentStatus: "PAID" } },
          { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
        ],
        outstanding: [
          { $match: { status: "CONFIRMED", paymentStatus: { $ne: "PAID" } } },
          { $group: { _id: null, revenue: { $sum: "$total" }, orders: { $sum: 1 } } },
        ],
        pending: [{ $match: { status: "PENDING" } }, { $group: { _id: null, revenue: { $sum: "$total" } } }],
        confirmedItems: [
          { $match: { status: "CONFIRMED" } },
          { $unwind: "$items" },
          { $group: { _id: null, itemsSold: { $sum: "$items.quantity" } } },
        ],
        tables: [
          {
            $group: {
              _id: "$tableNumber",
              orders: { $sum: 1 },
              revenue: { $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, "$total", 0] } },
            },
          },
          { $sort: { orders: -1, revenue: -1 } },
        ],
        sessions: [
          {
            $group: {
              _id: "$tableSessionId",
              orders: { $sum: 1 },
              revenue: { $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"] }, "$total", 0] } },
            },
          },
          { $sort: { orders: -1 } },
        ],
      },
    },
  ]).exec();
  if (!summary) return null;
  const counts = new Map<string, number>(
    (summary.statuses ?? []).map((row: { _id: string; count: number }) => [row._id, row.count]),
  );
  const confirmed = summary.confirmed?.[0] ?? {};
  const paid = summary.paid?.[0] ?? {};
  const outstanding = summary.outstanding?.[0] ?? {};
  const pending = summary.pending?.[0] ?? {};
  const confirmedItems = summary.confirmedItems?.[0] ?? {};
  return {
    totalOrders: (counts.get("PENDING") ?? 0) + (counts.get("CONFIRMED") ?? 0) + (counts.get("REJECTED") ?? 0),
    confirmedOrders: counts.get("CONFIRMED") ?? 0,
    pendingOrders: counts.get("PENDING") ?? 0,
    pendingRevenue: Number(pending.revenue ?? 0),
    rejectedOrders: counts.get("REJECTED") ?? 0,
    confirmedRevenue: Number(confirmed.revenue ?? 0),
    paidOrders: Number(paid.orders ?? 0),
    paidRevenue: Number(paid.revenue ?? 0),
    outstandingRevenue: Number(outstanding.revenue ?? 0),
    unpaidConfirmedOrders: Number(outstanding.orders ?? 0),
    averageConfirmedOrderValue: counts.get("CONFIRMED")
      ? Number(confirmed.revenue ?? 0) / (counts.get("CONFIRMED") ?? 1)
      : 0,
    itemsSold: Number(confirmedItems.itemsSold ?? 0),
    tablesServed: (summary.tables ?? []).length,
    tables: (summary.tables ?? []).map((row: { _id: number; orders: number; revenue: number }) => ({
      tableNumber: row._id,
      orders: row.orders,
      revenue: row.revenue,
    })),
    sessions: (summary.sessions ?? []).map((row: { _id: Types.ObjectId | null; orders: number; revenue: number }) => ({
      tableSessionId: row._id?.toString() ?? null,
      orders: row.orders,
      revenue: row.revenue,
    })),
  };
}
