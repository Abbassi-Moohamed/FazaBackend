import { Types } from "mongoose";
import { ItemCategoryModel } from "../models/item-category.model.js";
import { ItemModel } from "../models/item.model.js";
import { OrderModel, type OrderStatus, type PaymentStatus } from "../models/order.model.js";

export async function findMenuItemsForCoffee(coffeeId: string, itemIds: string[]) {
  if (!Types.ObjectId.isValid(coffeeId)) return [];
  const ids = itemIds.filter((id) => Types.ObjectId.isValid(id));
  if (ids.length !== itemIds.length || ids.length === 0) return [];
  const categories = await ItemCategoryModel.find({ coffeeId }).select({ _id: 1 }).lean().exec();
  return ItemModel.find({ _id: { $in: ids }, itemCategoryId: { $in: categories.map((c) => c._id) } })
    .select({ name: 1, image: 1, price: 1, promotion: 1, isAvailable: 1 })
    .lean()
    .exec();
}

export async function createOrder(input: Record<string, unknown>) {
  return OrderModel.create(input);
}

export async function listOrders(
  coffeeId: string,
  status?: OrderStatus,
  paymentStatus?: PaymentStatus,
  skip = 0,
  limit = 50,
) {
  const filter = { coffeeId, ...(status ? { status } : {}), ...(paymentStatus ? { paymentStatus } : {}) };
  const [orders, total] = await Promise.all([
    OrderModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
    OrderModel.countDocuments(filter).exec(),
  ]);
  return { orders, total };
}

export async function listOrdersByTableSession(tableSessionId: string, limit = 50) {
  if (!Types.ObjectId.isValid(tableSessionId)) return { orders: [], total: 0 };
  const filter = { tableSessionId: new Types.ObjectId(tableSessionId) };
  const [orders, total] = await Promise.all([
    OrderModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean().exec(),
    OrderModel.countDocuments(filter).exec(),
  ]);
  return { orders, total };
}

export async function findOrderWithSession(orderId: string) {
  if (!Types.ObjectId.isValid(orderId)) return null;
  return OrderModel.findById(orderId).select("+tableSessionId +serviceShiftId").lean().exec();
}

export async function findOrderOwnedByCoffee(coffeeId: string, orderId: string) {
  if (!Types.ObjectId.isValid(coffeeId) || !Types.ObjectId.isValid(orderId)) return null;
  return OrderModel.findOne({ _id: orderId, coffeeId }).lean().exec();
}

export async function findOrder(orderId: string) {
  if (!Types.ObjectId.isValid(orderId)) return null;
  return OrderModel.findById(orderId).lean().exec();
}

export async function updateOrderStatus(
  coffeeId: string,
  orderId: string,
  status: OrderStatus,
  changedAt: Date,
  serviceShiftId?: Types.ObjectId,
) {
  return OrderModel.findOneAndUpdate(
    { _id: orderId, coffeeId, ...(status === "CONFIRMED" ? { status: "PENDING" } : {}) },
    {
      $set: {
        status,
        ...(serviceShiftId ? { serviceShiftId } : {}),
      },
      $push: { statusHistory: { status, changedAt } },
    },
    { returnDocument: "after", runValidators: true },
  )
    .lean()
    .exec();
}

export async function markOrderPaid(coffeeId: string, orderId: string, paidAt: Date, paidBy: string) {
  return OrderModel.findOneAndUpdate(
    { _id: orderId, coffeeId, status: "CONFIRMED", paymentStatus: "UNPAID" },
    { $set: { paymentStatus: "PAID", paidAt, paidBy } },
    { returnDocument: "after", runValidators: true },
  )
    .lean()
    .exec();
}
