import {
  aggregateAnalytics,
  getAvailability,
  getMenuHealth,
  getPlatformCounts,
} from "../repositories/insights.repository.js";
import type { AnalyticsDto, InsightComparison, InsightKpis } from "../types/insights.js";
import { ApiError } from "../utils/ApiError.js";
import { findServiceShiftOwnedByCoffee } from "../repositories/service-shift.repository.js";

const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

interface LegacyPromotions {
  unitsSoldAtPromotionalPrice: number;
  promotedSalesRevenue: number;
  promotedItemsSold: number;
  discountAmount: number | null;
  historicalRegularPriceAvailable: boolean;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function parseBoundary(value: string | undefined, end: boolean): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `Invalid ${end ? "to" : "from"} date.`);
  if (end && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export function resolveRange(
  from?: string,
  to?: string,
): { from: Date; to: Date; previousFrom: Date; previousTo: Date } {
  const toDate = parseBoundary(to, true) ?? new Date();
  const fromDate = parseBoundary(from, false) ?? new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const duration = toDate.getTime() - fromDate.getTime();
  if (duration <= 0 || duration > MAX_RANGE_MS)
    throw new ApiError(400, "Date range must be positive and no longer than 366 days.");
  return {
    from: fromDate,
    to: toDate,
    previousFrom: new Date(fromDate.getTime() - duration),
    previousTo: new Date(toDate.getTime() - duration),
  };
}

function comparison(current: number, previous: number): InsightComparison {
  const change = round(current - previous);
  const changePercent = previous === 0 ? null : round((change / previous) * 100);
  return {
    current: round(current),
    previous: round(previous),
    change,
    changePercent,
    trend: change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
}

function toLegacyMetrics(
  summary: { confirmedOrders: number; confirmedRevenue: number; itemsSold: number },
  previous: { confirmedOrders: number; confirmedRevenue: number; itemsSold: number },
) {
  const averageOrderValue = summary.confirmedOrders === 0 ? 0 : summary.confirmedRevenue / summary.confirmedOrders;
  const previousAverageOrderValue =
    previous.confirmedOrders === 0 ? 0 : previous.confirmedRevenue / previous.confirmedOrders;
  return {
    orders: summary.confirmedOrders,
    revenue: round(summary.confirmedRevenue),
    itemsSold: summary.itemsSold,
    averageOrderValue: round(averageOrderValue),
    comparison: {
      orders: comparison(summary.confirmedOrders, previous.confirmedOrders),
      revenue: comparison(summary.confirmedRevenue, previous.confirmedRevenue),
      itemsSold: comparison(summary.itemsSold, previous.itemsSold),
      averageOrderValue: comparison(averageOrderValue, previousAverageOrderValue),
    },
  };
}

function granularity(durationMs: number): "hour" | "day" | "week" | "month" {
  if (durationMs <= 48 * 60 * 60 * 1000) return "hour";
  if (durationMs <= 62 * 24 * 60 * 60 * 1000) return "day";
  if (durationMs <= 366 * 24 * 60 * 60 * 1000) return "week";
  return "month";
}

function buildKpis(
  current: Awaited<ReturnType<typeof aggregateAnalytics>>,
  previous: Awaited<ReturnType<typeof aggregateAnalytics>>,
): InsightKpis {
  return {
    confirmedRevenue: comparison(current.confirmedRevenue, previous.confirmedRevenue),
    paidRevenue: comparison(current.paidRevenue, previous.paidRevenue),
    outstandingRevenue: comparison(current.outstandingRevenue, previous.outstandingRevenue),
    paymentRate: comparison(current.paymentRate, previous.paymentRate),
    totalOrders: comparison(current.totalOrders, previous.totalOrders),
    confirmedOrders: comparison(current.confirmedOrders, previous.confirmedOrders),
    pendingOrders: current.pendingOrders,
    rejectedOrders: current.rejectedOrders,
    averageConfirmedOrderValue: comparison(
      current.confirmedOrders ? current.confirmedRevenue / current.confirmedOrders : 0,
      previous.confirmedOrders ? previous.confirmedRevenue / previous.confirmedOrders : 0,
    ),
    itemsSold: comparison(current.itemsSold, previous.itemsSold),
    averageItemsPerOrder: comparison(
      current.confirmedOrders ? current.itemsSold / current.confirmedOrders : 0,
      previous.confirmedOrders ? previous.itemsSold / previous.confirmedOrders : 0,
    ),
    rejectionRate: comparison(
      rate(current.rejectedOrders, current.totalOrders),
      rate(previous.rejectedOrders, previous.totalOrders),
    ),
  };
}

/** Share of a total, in percent. */
function rate(part: number, total: number): number {
  return total === 0 ? 0 : (part / total) * 100;
}

export async function getInsights(
  coffeeId: string | undefined,
  from?: string,
  to?: string,
  serviceShiftId?: string,
): Promise<AnalyticsDto> {
  const range = resolveRange(from, to);
  const bucket = granularity(range.to.getTime() - range.from.getTime());
  if (serviceShiftId) {
    if (!coffeeId) {
      const { ServiceShiftModel } = await import("../models/service-shift.model.js");
      const shift = await ServiceShiftModel.findById(serviceShiftId).lean().exec();
      if (!shift) throw new ApiError(404, "Service shift not found.");
    } else if (!(await findServiceShiftOwnedByCoffee(coffeeId, serviceShiftId))) {
      throw new ApiError(404, "Service shift not found.");
    }
  }
  const [current, previous, availability, platform, menuHealth] = await Promise.all([
    aggregateAnalytics(coffeeId, range.from, range.to, bucket, serviceShiftId),
    aggregateAnalytics(coffeeId, range.previousFrom, range.previousTo, bucket, serviceShiftId),
    coffeeId ? getAvailability(coffeeId) : Promise.resolve({ availableItems: 0, unavailableItems: 0 }),
    coffeeId ? Promise.resolve(undefined) : getPlatformCounts(),
    coffeeId
      ? getMenuHealth(coffeeId, range.from, range.to, serviceShiftId)
      : Promise.resolve({ categories: [], deadStock: { unsoldItems: 0, items: [] } }),
  ]);
  const legacyMetrics = toLegacyMetrics(current, previous);
  const statusTotal = current.totalOrders || 1;
  const insights = [];
  if (current.totalOrders === 0)
    insights.push({
      id: "no-data",
      message: "Pas encore assez de données pour dégager une tendance fiable.",
      kind: "neutral" as const,
    });
  const topItem = current.topItems[0];
  if (topItem)
    insights.push({
      id: "best-seller",
      message: `Votre article le plus vendu est « ${topItem.name} ».`,
      kind: "positive" as const,
    });
  if (current.peakHours.length) {
    const peak = current.peakHours.reduce((a, b) => (b.orders > a.orders ? b : a));
    insights.push({
      id: "peak-hour",
      message: `Votre pic d’activité se situe à ${String(peak.hour).padStart(2, "0")} h.`,
      kind: "neutral" as const,
    });
  }
  const { categories, deadStock } = menuHealth;
  const leadingCategory = categories[0];
  if (leadingCategory && leadingCategory.percentageOfRevenue > 0)
    insights.push({
      id: "leading-category",
      message: `La catégorie « ${leadingCategory.categoryName} » représente ${leadingCategory.percentageOfRevenue.toFixed(0)} % du chiffre d’affaires.`,
      kind: "neutral" as const,
    });
  if (deadStock.unsoldItems > 0)
    insights.push({
      id: "dead-stock",
      message: `${deadStock.unsoldItems} article${deadStock.unsoldItems > 1 ? "s" : ""} de la carte ${
        deadStock.unsoldItems > 1 ? "n’ont pas été vendus" : "n’a pas été vendu"
      } sur la période.`,
      kind: "warning" as const,
    });
  if (current.totalOrders > 0 && rate(current.rejectedOrders, current.totalOrders) >= 5)
    insights.push({
      id: "rejection-rate",
      message: `${rate(current.rejectedOrders, current.totalOrders).toFixed(0)} % des commandes ont été refusées.`,
      kind: "warning" as const,
    });
  if (availability.unavailableItems > 0)
    insights.push({
      id: "availability",
      message: `${availability.unavailableItems} article${availability.unavailableItems > 1 ? "s" : ""} ${
        availability.unavailableItems > 1 ? "sont indisponibles" : "est indisponible"
      } sur la carte.`,
      kind: "warning" as const,
    });
  return {
    scope: coffeeId ? "coffee" : "platform",
    timezone: "UTC",
    period: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      granularity: bucket,
      startDate: range.from.toISOString(),
      endDate: range.to.toISOString(),
    } as AnalyticsDto["period"] & { startDate: string; endDate: string },
    comparisonPeriod: {
      from: range.previousFrom.toISOString(),
      to: range.previousTo.toISOString(),
      startDate: range.previousFrom.toISOString(),
      endDate: range.previousTo.toISOString(),
    } as AnalyticsDto["comparisonPeriod"] & { startDate: string; endDate: string },
    kpis: buildKpis(current, previous),
    metrics: legacyMetrics,
    comparison: legacyMetrics.comparison,
    revenueTrend: current.trend,
    orderTrend: current.trend,
    topItems: current.topItems,
    categories,
    peakHours: current.peakHours,
    hourly: current.hourly,
    busiestDays: current.busiestDays,
    statuses: (["PENDING", "CONFIRMED", "REJECTED"] as const).map((status) => ({
      status,
      count: current[`${status.toLowerCase()}Orders` as "pendingOrders" | "confirmedOrders" | "rejectedOrders"],
      percentage: round(
        (current[`${status.toLowerCase()}Orders` as "pendingOrders" | "confirmedOrders" | "rejectedOrders"] /
          statusTotal) *
          100,
      ),
    })),
    promotions: {
      unitsSoldAtPromotionalPrice: 0,
      promotedSalesRevenue: 0,
      promotedItemsSold: 0,
      discountAmount: null,
      historicalRegularPriceAvailable: false,
    } satisfies LegacyPromotions,
    availability: {
      ...availability,
      availabilityPercentage:
        availability.availableItems + availability.unavailableItems
          ? round((availability.availableItems / (availability.availableItems + availability.unavailableItems)) * 100)
          : 0,
      historicalRateAvailable: false,
    },
    tables: current.tables,
    deadStock,
    insights,
    limitations: [
      "Les commandes ne stockent pas le prix normal historique; les analyses de promotion restent volontairement indisponibles.",
      "Les catégories sont déduites de la carte actuelle: un article supprimé depuis la vente n'est rattaché à aucune catégorie.",
      "Le taux de disponibilité historique ne peut pas être calculé sans historique des changements.",
      "Le fuseau métier est UTC.",
    ],
    ...(platform ? { platform } : {}),
  } as AnalyticsDto & {
    metrics: typeof legacyMetrics;
    comparison: typeof legacyMetrics.comparison;
    promotions: LegacyPromotions;
    period: AnalyticsDto["period"] & { startDate: string; endDate: string };
    comparisonPeriod: AnalyticsDto["comparisonPeriod"] & { startDate: string; endDate: string };
  };
}
