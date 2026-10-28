export type InsightTrend = "up" | "down" | "flat";

export interface InsightComparison {
  current: number;
  previous: number;
  change: number;
  changePercent: number | null;
  trend: InsightTrend;
}

export interface InsightKpis {
  confirmedRevenue: InsightComparison;
  paidRevenue: InsightComparison;
  outstandingRevenue: InsightComparison;
  paymentRate: InsightComparison;
  totalOrders: InsightComparison;
  confirmedOrders: InsightComparison;
  pendingOrders: number;
  rejectedOrders: number;
  averageConfirmedOrderValue: InsightComparison;
  itemsSold: InsightComparison;
  /** Average number of items per confirmed order — the basket size. */
  averageItemsPerOrder: InsightComparison;
  /** Share of the orders that were refused, in percent. */
  rejectionRate: InsightComparison;
}

export interface InsightPoint {
  bucket: string;
  revenue: number;
  orders: number;
}

/** One hour of the day, with the orders and the revenue it produced. */
export interface InsightHourlyPoint {
  hour: number;
  orders: number;
  revenue: number;
}

/** A menu item that was never sold during the analysed period. */
export interface InsightDeadStockItem {
  itemId: string;
  name: string;
  categoryName: string;
  price: number;
}

/** Menu items without a single sale — the ones to review or to retire. */
export interface InsightDeadStock {
  unsoldItems: number;
  items: InsightDeadStockItem[];
}

export interface InsightTopItem {
  itemId: string;
  name: string;
  quantitySold: number;
  revenue: number;
}

export interface InsightItemEngagement {
  itemId: string;
  name: string;
  /** Unique detail openings per browser tab session. */
  views: number;
  confirmedOrders: number;
  unitsSold: number;
  /** Share of current-menu item views within the selected period. */
  viewsSharePercent: number;
  /** Share of confirmed order-item pairs within the selected period. */
  ordersSharePercent: number | null;
  /** Percentage-point difference between view share and order share. */
  interestGapPoints: number | null;
  /** Confirmed orders containing this item per 100 detail openings. */
  ordersPer100Views: number | null;
}

export interface InsightItemEngagementSummary {
  views: number;
  /** Confirmed order-item pairs; an order containing two items counts twice. */
  itemOrders: number;
  unitsSold: number;
  ordersPer100Views: number | null;
}

export interface InsightCategory {
  categoryId: string;
  categoryName: string;
  quantitySold: number;
  revenue: number;
  percentageOfRevenue: number;
}

export interface InsightStatus {
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  count: number;
  percentage: number;
}

export interface InsightPromotionSummary {
  unitsSoldAtPromotionalPrice: number;
  promotedSalesRevenue: number;
  promotedItemsSold: number;
  discountAmount: number | null;
  historicalRegularPriceAvailable: false;
}

export interface InsightAvailability {
  availableItems: number;
  unavailableItems: number;
  availabilityPercentage: number;
  historicalRateAvailable: false;
}

export interface InsightTable {
  tableNumber: number;
  orders: number;
  revenue: number;
}

export interface InsightMessage {
  id: string;
  message: string;
  kind: "positive" | "warning" | "neutral";
}

export interface AnalyticsDto {
  scope: "coffee" | "platform";
  timezone: "UTC";
  period: { from: string; to: string; granularity: "hour" | "day" | "week" | "month" };
  comparisonPeriod: { from: string; to: string };
  kpis: InsightKpis;
  revenueTrend: InsightPoint[];
  orderTrend: InsightPoint[];
  topItems: InsightTopItem[];
  /** Coffee-wide detail views and sales for the selected date range. */
  itemEngagement?: InsightItemEngagement[];
  itemEngagementSummary?: InsightItemEngagementSummary;
  categories: InsightCategory[];
  peakHours: Array<{ hour: number; orders: number }>;
  /** Same hourly breakdown as `peakHours`, enriched with the revenue. */
  hourly: InsightHourlyPoint[];
  busiestDays: Array<{ dayOfWeek: number; orders: number; revenue: number }>;
  statuses: InsightStatus[];
  promotions: InsightPromotionSummary;
  availability: InsightAvailability;
  /** Menu items of the coffee that were never sold during the period. */
  deadStock: InsightDeadStock;
  tables: InsightTable[];
  insights: InsightMessage[];
  limitations: string[];
  platform?: { totalCoffees: number; activeCoffees: number };
}
