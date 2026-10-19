import type { Request, Response } from "express";
import type { OrderStatus, PaymentStatus } from "../../../models/order.model.js";
import {
  changeOrderStatus,
  getCoffeeOrder,
  getCoffeeOrders,
  validateOrderPayment,
} from "../../../services/order.service.js";
import { sendSuccess } from "../../../utils/http.js";
const coffeeId = (req: Request) => req.admin!.coffeeId!;

export async function listMyOrdersController(req: Request, res: Response): Promise<void> {
  const query = req.validated!.query as {
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    page: number;
    limit: number;
  };
  sendSuccess(res, await getCoffeeOrders(coffeeId(req), query.status, query.paymentStatus, query.page, query.limit));
}
export async function getMyOrderController(req: Request, res: Response): Promise<void> {
  const { orderId } = req.validated!.params as { orderId: string };
  sendSuccess(res, await getCoffeeOrder(coffeeId(req), orderId));
}
export async function updateMyOrderStatusController(req: Request, res: Response): Promise<void> {
  const { orderId } = req.validated!.params as { orderId: string };
  const { status } = req.validated!.body as { status: OrderStatus };
  sendSuccess(res, await changeOrderStatus(coffeeId(req), orderId, status));
}

export async function markMyOrderPaidController(req: Request, res: Response): Promise<void> {
  const { orderId } = req.validated!.params as { orderId: string };
  sendSuccess(res, await validateOrderPayment(coffeeId(req), orderId, req.admin?.role ?? "COFFEE_ADMIN"));
}
