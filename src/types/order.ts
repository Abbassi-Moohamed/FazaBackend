import type { OrderStatus, PaymentStatus } from "../models/order.model.js";

export interface OrderItemDto {
  itemId: string;
  name: string;
  image: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

/** One component of an offered bundle, snapshotted at order time. */
export interface OrderOfferLineDto {
  name: string;
  quantity: number;
}

/** A daily offer purchased at its bundle price, snapshotted at order time. */
export interface OrderOfferDto {
  offerId: string;
  name: string;
  image: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  lines: OrderOfferLineDto[];
}

export interface OrderDto {
  id: string;
  coffeeId: string;
  tableNumber: number;
  items: OrderItemDto[];
  offers: OrderOfferDto[];
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paidAt: Date | null;
  paidBy: string | null;
  tableSessionId: string | null;
  serviceShiftId: string | null;
  /** Returned only when a new/accepted anonymous session token is supplied. */
  sessionToken?: string;
  createdAt: Date;
  updatedAt: Date;
}
