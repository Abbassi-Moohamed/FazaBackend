import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { TableSessionModel, type TableSessionStatus } from "../models/table-session.model.js";

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function findTableSessionByToken(token: string) {
  return TableSessionModel.findOne({ sessionTokenHash: hashSessionToken(token) })
    .select("+sessionTokenHash")
    .exec();
}

export async function createTableSession(input: {
  coffeeId: Types.ObjectId;
  tableNumber: number;
  serviceShiftId: Types.ObjectId | null;
  sessionTokenHash: string;
}) {
  return TableSessionModel.create(input);
}

export async function touchTableSession(sessionId: Types.ObjectId, at = new Date()): Promise<void> {
  await TableSessionModel.updateOne(
    { _id: sessionId, status: "ACTIVE" },
    { $set: { lastOrderAt: at }, $inc: { orderCount: 1 } },
  ).exec();
}

export async function assignTableSessionToServiceShift(
  coffeeId: string,
  sessionId: Types.ObjectId,
  serviceShiftId: Types.ObjectId,
): Promise<void> {
  await TableSessionModel.updateOne(
    {
      _id: sessionId,
      coffeeId: new Types.ObjectId(coffeeId),
      status: "ACTIVE",
    },
    { $set: { serviceShiftId } },
  ).exec();
}

export async function closeTableSession(coffeeId: string, sessionId: string, closedAt = new Date()) {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(sessionId)) return null;
  return TableSessionModel.findOneAndUpdate(
    { _id: sessionId, coffeeId, status: "ACTIVE" },
    { $set: { status: "CLOSED", closedAt } },
    { returnDocument: "after", runValidators: true },
  )
    .lean()
    .exec();
}

export async function listTableSessions(
  coffeeId: string,
  options: { serviceShiftId?: string; status?: TableSessionStatus; skip?: number; limit?: number } = {},
) {
  if (!Types.ObjectId.isValid(coffeeId)) return { sessions: [], total: 0 };
  const filter: Record<string, unknown> = { coffeeId: new Types.ObjectId(coffeeId) };
  if (options.serviceShiftId && Types.ObjectId.isValid(options.serviceShiftId))
    filter.serviceShiftId = new Types.ObjectId(options.serviceShiftId);
  if (options.status) filter.status = options.status;
  const skip = options.skip ?? 0;
  const limit = options.limit ?? 50;
  const [sessions, total] = await Promise.all([
    TableSessionModel.aggregate([
      { $match: filter },
      { $sort: { lastOrderAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "orders",
          let: { sessionId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$tableSessionId", "$$sessionId"] } } },
            {
              $group: {
                _id: { status: "$status", paymentStatus: "$paymentStatus" },
                count: { $sum: 1 },
                revenue: { $sum: "$total" },
              },
            },
          ],
          as: "orderSummary",
        },
      },
    ]).exec(),
    TableSessionModel.countDocuments(filter).exec(),
  ]);
  return { sessions, total };
}

export async function getTableSessionSummary(coffeeId: string, sessionId: string) {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(sessionId)) return null;
  const [summary] = await TableSessionModel.aggregate([
    { $match: { _id: new Types.ObjectId(sessionId), coffeeId: new Types.ObjectId(coffeeId) } },
    {
      $lookup: {
        from: "orders",
        localField: "_id",
        foreignField: "tableSessionId",
        as: "orders",
      },
    },
    {
      $project: {
        _id: 1,
        coffeeId: 1,
        orders: 1,
        tableNumber: 1,
        serviceShiftId: 1,
        status: 1,
        openedAt: 1,
        closedAt: 1,
        lastOrderAt: 1,
        orderCount: 1,
        totalOrders: { $size: "$orders" },
        confirmedOrders: {
          $size: { $filter: { input: "$orders", as: "order", cond: { $eq: ["$$order.status", "CONFIRMED"] } } },
        },
        pendingOrders: {
          $size: { $filter: { input: "$orders", as: "order", cond: { $eq: ["$$order.status", "PENDING"] } } },
        },
        pendingRevenue: {
          $sum: {
            $map: {
              input: { $filter: { input: "$orders", as: "order", cond: { $eq: ["$$order.status", "PENDING"] } } },
              as: "order",
              in: "$$order.total",
            },
          },
        },
        rejectedOrders: {
          $size: { $filter: { input: "$orders", as: "order", cond: { $eq: ["$$order.status", "REJECTED"] } } },
        },
        confirmedRevenue: {
          $sum: {
            $map: {
              input: { $filter: { input: "$orders", as: "order", cond: { $eq: ["$$order.status", "CONFIRMED"] } } },
              as: "order",
              in: "$$order.total",
            },
          },
        },
        paidRevenue: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: "$orders",
                  as: "order",
                  cond: {
                    $and: [{ $eq: ["$$order.status", "CONFIRMED"] }, { $eq: ["$$order.paymentStatus", "PAID"] }],
                  },
                },
              },
              as: "order",
              in: "$$order.total",
            },
          },
        },
        outstandingRevenue: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: "$orders",
                  as: "order",
                  cond: {
                    $and: [{ $eq: ["$$order.status", "CONFIRMED"] }, { $ne: ["$$order.paymentStatus", "PAID"] }],
                  },
                },
              },
              as: "order",
              in: "$$order.total",
            },
          },
        },
        itemsSold: {
          $sum: {
            $map: {
              input: { $filter: { input: "$orders", as: "order", cond: { $eq: ["$$order.status", "CONFIRMED"] } } },
              as: "order",
              in: { $sum: "$$order.items.quantity" },
            },
          },
        },
      },
    },
  ]).exec();
  return summary ?? null;
}
