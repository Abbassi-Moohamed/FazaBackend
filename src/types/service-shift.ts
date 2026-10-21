import type { ServiceShiftStatus, ServiceShiftType } from "../models/service-shift.model.js";

export interface ServiceShiftDto {
  id: string;
  coffeeId: string;
  status: ServiceShiftStatus;
  name: string | null;
  type: ServiceShiftType;
  label: string | null;
  notes: string | null;
  openedAt: Date;
  closedAt: Date | null;
  summary?: unknown;
}

/**
 * Aggregated bill of a table session. Computed by the server so the
 * backoffice never has to rebuild it from a truncated order list.
 */
export interface TableSessionTotals {
  totalOrders: number;
  confirmedOrders: number;
  pendingOrders: number;
  rejectedOrders: number;
  confirmedRevenue: number;
  paidRevenue: number;
  outstandingRevenue: number;
  pendingRevenue: number;
}

export interface TableSessionDto {
  id: string;
  coffeeId: string;
  tableNumber: number;
  serviceShiftId: string | null;
  status: "ACTIVE" | "CLOSED";
  openedAt: Date;
  closedAt: Date | null;
  lastOrderAt: Date;
  orderCount: number;
  summary?: unknown;
  totals?: TableSessionTotals;
}
