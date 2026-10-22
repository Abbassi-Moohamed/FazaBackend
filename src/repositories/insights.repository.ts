import { Types, type PipelineStage } from "mongoose";
import { ItemModel } from "../models/item.model.js";
import { ItemCategoryModel } from "../models/item-category.model.js";
import { OrderModel } from "../models/order.model.js";
import type { InsightCategory, InsightDeadStock, InsightDeadStockItem } from "../types/insights.js";

export interface AnalyticsRangeResult {
  totalOrders: number;
  confirmedOrders: number;
  pendingOrders: number;
  rejectedOrders: number;
  confirmedRevenue: number;
  paidRevenue: number;
  outstandingRevenue: number;
  paymentRate: number;
  itemsSold: number;
  trend: Array<{ bucket: string; revenue: number; orders: number }>;
  topItems: Array<{ itemId: string; name: string; quantitySold: number; revenue: number }>;
  peakHours: Array<{ hour: number; orders: number }>;
  hourly: Array<{ hour: number; orders: number; revenue: number }>;
  busiestDays: Array<{ dayOfWeek: number; orders: number; revenue: number }>;
  tables: Array<{ tableNumber: number; orders: number; revenue: number }>;
}

const zero: AnalyticsRangeResult = {
  totalOrders: 0,
  confirmedOrders: 0,
  pendingOrders: 0,
  rejectedOrders: 0,
  confirmedRevenue: 0,
  paidRevenue: 0,
  outstandingRevenue: 0,
  paymentRate: 0,
  itemsSold: 0,
  trend: [],
  topItems: [],
  peakHours: [],
  hourly: [],
  busiestDays: [],
  tables: [],
};

function objectId(value?: string): Types.ObjectId | undefined {
  return value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;
}

export async function aggregateAnalytics(
  coffeeId: string | undefined,
  from: Date,
  to: Date,
  granularity: "hour" | "day" | "week" | "month",
  serviceShiftId?: string,
): Promise<AnalyticsRangeResult> {
  const match: Record<string, unknown> = { createdAt: { $gte: from, $lt: to } };
  const id = objectId(coffeeId);
  if (coffeeId && !id) return zero;
  if (id) match.coffeeId = id;
  if (serviceShiftId) {
    if (!Types.ObjectId.isValid(serviceShiftId)) return zero;
    match.serviceShiftId = new Types.ObjectId(serviceShiftId);
  }
  const dateFormat = granularity === "hour" ? "%Y-%m-%dT%H:00:00.000Z" : granularity === "month" ? "%Y-%m" : "%Y-%m-%d";
  const pipeline = [
    { $match: match },
    {
      $facet: {
        statuses: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        summary: [
          { $match: { status: "CONFIRMED" } },
          {
            $group: {
              _id: null,
              orders: { $sum: 1 },
              revenue: { $sum: "$total" },
              items: { $sum: { $sum: "$items.quantity" } },
            },
          },
        ],
        payment: [
          { $match: { status: "CONFIRMED" } },
          { $group: { _id: "$paymentStatus", revenue: { $sum: "$total" } } },
        ],
        trend: [
          { $match: { status: "CONFIRMED" } },
          {
            $project: {
              bucket: { $dateToString: { format: dateFormat, date: "$createdAt", timezone: "UTC" } },
              total: 1,
            },
          },
          { $group: { _id: "$bucket", revenue: { $sum: "$total" }, orders: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ],
        items: [
          { $match: { status: "CONFIRMED" } },
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.itemId",
              name: { $first: "$items.name" },
              quantitySold: { $sum: "$items.quantity" },
              revenue: { $sum: "$items.subtotal" },
            },
          },
          { $sort: { quantitySold: -1, revenue: -1 } },
          { $limit: 10 },
        ],
        hours: [
          { $match: { status: "CONFIRMED" } },
          {
            $group: {
              _id: { $hour: { date: "$createdAt", timezone: "UTC" } },
              orders: { $sum: 1 },
              revenue: { $sum: "$total" },
            },
          },
          { $sort: { _id: 1 } },
        ],
        days: [
          { $match: { status: "CONFIRMED" } },
          {
            $group: {
              _id: { $dayOfWeek: { date: "$createdAt", timezone: "UTC" } },
              orders: { $sum: 1 },
              revenue: { $sum: "$total" },
            },
          },
          { $sort: { _id: 1 } },
        ],
        tables: [
          { $match: { status: "CONFIRMED" } },
          { $group: { _id: "$tableNumber", orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
          { $sort: { orders: -1, revenue: -1 } },
          { $limit: 10 },
        ],
      },
    },
  ] as unknown as PipelineStage[];
  const [row] = await OrderModel.aggregate(pipeline).allowDiskUse(true).exec();
  if (!row) return zero;
  const counts = new Map<string, number>(
    (row.statuses ?? []).map((v: { _id: string; count: number }) => [v._id, v.count]),
  );
  const summary = row.summary?.[0] ?? {};
  const paymentRows = new Map<string, number>(
    (row.payment ?? []).map((v: { _id: string; revenue: number }) => [v._id, Number(v.revenue ?? 0)]),
  );
  const confirmedRevenue = Number(summary.revenue ?? 0);
  const paidRevenue = paymentRows.get("PAID") ?? 0;
  return {
    totalOrders: (counts.get("PENDING") ?? 0) + (counts.get("CONFIRMED") ?? 0) + (counts.get("REJECTED") ?? 0),
    confirmedOrders: counts.get("CONFIRMED") ?? 0,
    pendingOrders: counts.get("PENDING") ?? 0,
    rejectedOrders: counts.get("REJECTED") ?? 0,
    confirmedRevenue,
    paidRevenue,
    outstandingRevenue: Math.max(0, confirmedRevenue - paidRevenue),
    paymentRate: confirmedRevenue === 0 ? 0 : (paidRevenue / confirmedRevenue) * 100,
    itemsSold: Number(summary.items ?? 0),
    trend: (row.trend ?? []).map((v: { _id: string; revenue: number; orders: number }) => ({
      bucket: v._id,
      revenue: v.revenue,
      orders: v.orders,
    })),
    topItems: (row.items ?? []).map(
      (v: { _id: Types.ObjectId; name: string; quantitySold: number; revenue: number }) => ({
        itemId: String(v._id),
        name: v.name,
        quantitySold: v.quantitySold,
        revenue: v.revenue,
      }),
    ),
    peakHours: (row.hours ?? []).map((v: { _id: number; orders: number }) => ({ hour: v._id, orders: v.orders })),
    hourly: (row.hours ?? []).map((v: { _id: number; orders: number; revenue: number }) => ({
      hour: v._id,
      orders: v.orders,
      revenue: Number(v.revenue ?? 0),
    })),
    busiestDays: (row.days ?? []).map((v: { _id: number; orders: number; revenue: number }) => ({
      dayOfWeek: v._id,
      orders: v.orders,
      revenue: v.revenue,
    })),
    tables: (row.tables ?? []).map((v: { _id: number; orders: number; revenue: number }) => ({
      tableNumber: v._id,
      orders: v.orders,
      revenue: v.revenue,
    })),
  };
}

export async function getAvailability(coffeeId: string): Promise<{ availableItems: number; unavailableItems: number }> {
  const id = objectId(coffeeId);
  if (!id) return { availableItems: 0, unavailableItems: 0 };
  const categoryIds = await ItemCategoryModel.find({ coffeeId: id }).distinct("_id").exec();
  if (categoryIds.length === 0) return { availableItems: 0, unavailableItems: 0 };
  const [availableItems, unavailableItems] = await Promise.all([
    ItemModel.countDocuments({ itemCategoryId: { $in: categoryIds }, isAvailable: { $ne: false } }).exec(),
    ItemModel.countDocuments({ itemCategoryId: { $in: categoryIds }, isAvailable: false }).exec(),
  ]);
  return { availableItems, unavailableItems };
}

/* ---- Menu health: what sells, what never sells ------------------------- */

interface CatalogItem {
  itemId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  price: number;
}

/** Every item of the coffee, with the category it belongs to. */
async function getCatalog(coffeeId: string): Promise<CatalogItem[]> {
  const id = objectId(coffeeId);
  if (!id) return [];
  const categories = await ItemCategoryModel.find({ coffeeId: id }).select({ _id: 1, name: 1 }).lean().exec();
  if (categories.length === 0) return [];
  const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));
  const items = await ItemModel.find({ itemCategoryId: { $in: categories.map((category) => category._id) } })
    .select({ _id: 1, name: 1, itemCategoryId: 1, price: 1 })
    .lean()
    .exec();
  return items.map((item) => ({
    itemId: String(item._id),
    name: item.name,
    categoryId: String(item.itemCategoryId),
    categoryName: categoryNames.get(String(item.itemCategoryId)) ?? "",
    price: Number(item.price ?? 0),
  }));
}

/** Quantity and revenue sold per item during the period (confirmed orders). */
async function getSoldQuantities(
  coffeeId: string,
  from: Date,
  to: Date,
  serviceShiftId?: string,
): Promise<Map<string, { quantity: number; revenue: number }>> {
  const id = objectId(coffeeId);
  if (!id) return new Map();
  const match: Record<string, unknown> = {
    coffeeId: id,
    status: "CONFIRMED",
    createdAt: { $gte: from, $lt: to },
  };
  if (serviceShiftId && Types.ObjectId.isValid(serviceShiftId))
    match.serviceShiftId = new Types.ObjectId(serviceShiftId);
  const rows = await OrderModel.aggregate([
    { $match: match },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.itemId",
        quantity: { $sum: "$items.quantity" },
        revenue: { $sum: "$items.subtotal" },
      },
    },
  ]).exec();
  return new Map(
    rows.map((row: { _id: Types.ObjectId; quantity: number; revenue: number }) => [
      String(row._id),
      { quantity: Number(row.quantity ?? 0), revenue: Number(row.revenue ?? 0) },
    ]),
  );
}

/**
 * Revenue and volume per category.
 *
 * The orders only store the item, so the category is read from the current
 * menu: an item deleted since the sale is not attached to any category.
 */
export async function getCategoryBreakdown(
  coffeeId: string,
  from: Date,
  to: Date,
  serviceShiftId?: string,
): Promise<InsightCategory[]> {
  const catalog = await getCatalog(coffeeId);
  if (catalog.length === 0) return [];
  const sold = await getSoldQuantities(coffeeId, from, to, serviceShiftId);
  const byCategory = new Map<string, { categoryName: string; quantitySold: number; revenue: number }>();
  for (const item of catalog) {
    const entry = byCategory.get(item.categoryId) ?? {
      categoryName: item.categoryName,
      quantitySold: 0,
      revenue: 0,
    };
    const soldItem = sold.get(item.itemId);
    entry.quantitySold += soldItem?.quantity ?? 0;
    entry.revenue += soldItem?.revenue ?? 0;
    byCategory.set(item.categoryId, entry);
  }
  const total = [...byCategory.values()].reduce((sum, category) => sum + category.revenue, 0);
  return [...byCategory.entries()]
    .map(([categoryId, category]) => ({
      categoryId,
      categoryName: category.categoryName,
      quantitySold: category.quantitySold,
      revenue: Number(category.revenue.toFixed(2)),
      percentageOfRevenue: total === 0 ? 0 : Number(((category.revenue / total) * 100).toFixed(2)),
    }))
    .sort((a, b) => b.revenue - a.revenue || a.categoryName.localeCompare(b.categoryName));
}

/** Menu items that were never sold during the period. */
export async function getDeadStock(
  coffeeId: string,
  from: Date,
  to: Date,
  serviceShiftId?: string,
): Promise<InsightDeadStock> {
  const catalog = await getCatalog(coffeeId);
  if (catalog.length === 0) return { unsoldItems: 0, items: [] };
  const sold = await getSoldQuantities(coffeeId, from, to, serviceShiftId);
  const unsold = catalog.filter((item) => (sold.get(item.itemId)?.quantity ?? 0) === 0);
  const items: InsightDeadStockItem[] = unsold
    .sort((a, b) => b.price - a.price || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map((item) => ({
      itemId: item.itemId,
      name: item.name,
      categoryName: item.categoryName,
      price: item.price,
    }));
  return { unsoldItems: unsold.length, items };
}

export async function getPlatformCounts(): Promise<{ totalCoffees: number; activeCoffees: number }> {
  const { CoffeeModel } = await import("../models/coffee.model.js");
  const [totalCoffees, activeCoffees] = await Promise.all([
    CoffeeModel.countDocuments(),
    CoffeeModel.countDocuments({}),
  ]);
  return { totalCoffees, activeCoffees };
}
