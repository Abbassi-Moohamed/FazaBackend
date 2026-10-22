import type { OrderStatus, PaymentStatus } from "../models/order.model.js";

/**
 * Bill of a table, as the backoffice sees it.
 *
 * The admin works with tables, never with client sessions: several sessions
 * (different parties) can share a table, and the table is settled as a whole.
 */
export interface AdminTableTotals {
  /** Every order of the table, rejected ones included. */
  totalOrders: number;
  confirmedOrders: number;
  pendingOrders: number;
  rejectedOrders: number;
  /** Money booked by the table (confirmed orders). */
  confirmedRevenue: number;
  paidRevenue: number;
  /** Confirmed but not paid yet. */
  outstandingRevenue: number;
  pendingRevenue: number;
}

/** One order of a table, with everything the admin needs to settle it. */
export interface AdminTableOrderDto {
  id: string;
  /** Table the order belongs to. */
  tableNumber: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  total: number;
  /** ISO date of the order — the admin needs to know when it was placed. */
  createdAt: string;
  paidAt: string | null;
  items: Array<{ name: string; quantity: number }>;
}

/** A table currently open in the coffee. */
export interface AdminTableDto {
  tableNumber: number;
  /** Number of client sessions currently open on the table. */
  sessions: number;
  /** Opening of the oldest session of the table. */
  openedAt: string;
  /** Date of the last order of the table. */
  lastOrderAt: string;
  totals: AdminTableTotals;
  /** Every order of the table, newest first. */
  orders: AdminTableOrderDto[];
}

export interface AdminTableListDto {
  tables: AdminTableDto[];
  total: number;
}

export interface AdminTableCloseDto {
  tableNumber: number;
  /** Sessions closed by the operation. */
  closedSessions: number;
  totals: AdminTableTotals;
}
