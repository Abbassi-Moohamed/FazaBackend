import { Router } from "express";
import {
  createOrderController,
  getOrderController,
  listSessionOrdersController,
} from "../../controllers/order.controller.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  createOrderBodySchema,
  orderIdParamsSchema,
  publicOrderQuerySchema,
  sessionOrdersQuerySchema,
} from "../../validators/order.validators.js";

export const orderRouter = Router();
orderRouter.post("/orders", validate({ body: createOrderBodySchema }), createOrderController);
orderRouter.get("/orders", validate({ query: sessionOrdersQuerySchema }), listSessionOrdersController);
orderRouter.get(
  "/orders/:orderId",
  validate({ params: orderIdParamsSchema, query: publicOrderQuerySchema }),
  getOrderController,
);
