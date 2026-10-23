import { z } from "zod";
import { MONGODB_ID_MESSAGE, MONGODB_ID_PATTERN } from "./category.validators.js";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "../models/order.model.js";

const objectId = z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE);

export const createOrderBodySchema = z
  .object({
    coffeeSlug: z.string().trim().toLowerCase().min(1).max(80),
    tableNumber: z.coerce.number().int().min(1).max(10000),
    items: z
      .array(z.object({ itemId: objectId, quantity: z.number().int().min(1).max(99) }))
      .min(1)
      .max(50)
      .optional()
      .default([]),
    offers: z
      .array(z.object({ offerId: objectId, quantity: z.number().int().min(1).max(99) }))
      .min(1)
      .max(20)
      .optional()
      .default([]),
    sessionToken: z.string().trim().min(20).max(256).optional(),
  })
  .refine((value) => value.items.length + value.offers.length > 0, {
    message: "Provide at least one item or offer.",
    path: ["items"],
  })
  .refine((value) => new Set(value.offers.map((offer) => offer.offerId)).size === value.offers.length, {
    message: "An offer can appear only once in an order.",
    path: ["offers"],
  });

export const orderIdParamsSchema = z.object({ orderId: objectId });
export const publicOrderQuerySchema = z.object({ sessionToken: z.string().trim().min(20).max(256).optional() });
export const sessionOrdersQuerySchema = z.object({
  sessionToken: z.string().trim().min(20).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const orderStatusBodySchema = z.object({ status: z.enum(ORDER_STATUSES) });
export const listOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
