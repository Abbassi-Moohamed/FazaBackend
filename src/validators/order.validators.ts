import { z } from "zod";
import { MONGODB_ID_MESSAGE, MONGODB_ID_PATTERN } from "./category.validators.js";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "../models/order.model.js";

const objectId = z.string().regex(MONGODB_ID_PATTERN, MONGODB_ID_MESSAGE);

export const createOrderBodySchema = z.object({
  coffeeSlug: z.string().trim().toLowerCase().min(1).max(80),
  tableNumber: z.coerce.number().int().min(1).max(10000),
  items: z
    .array(z.object({ itemId: objectId, quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50),
  sessionToken: z.string().trim().min(20).max(256).optional(),
});

export const orderIdParamsSchema = z.object({ orderId: objectId });
export const publicOrderQuerySchema = z.object({ sessionToken: z.string().trim().min(20).max(256).optional() });
export const orderStatusBodySchema = z.object({ status: z.enum(ORDER_STATUSES) });
export const listOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
