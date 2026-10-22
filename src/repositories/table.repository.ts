import { Types } from "mongoose";
import { TableSessionModel } from "../models/table-session.model.js";

/**
 * Table-level view of the coffee.
 *
 * The backoffice settles tables, not client sessions: a table can host
 * several sessions (one per party), so the queries below group the sessions
 * by table number and gather every order they hold.
 */

export interface TableOrderDoc {
  _id: Types.ObjectId;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: Date;
  paidAt: Date | null;
  items: Array<{ name: string; quantity: number }>;
}

export interface CoffeeTableRow {
  tableNumber: number;
  sessionIds: Types.ObjectId[];
  openedAt: Date;
  lastOrderAt: Date;
  orders: TableOrderDoc[];
}

async function aggregateTables(coffeeId: string, tableNumber?: number): Promise<CoffeeTableRow[]> {
  if (!Types.ObjectId.isValid(coffeeId)) return [];
  const match: Record<string, unknown> = {
    coffeeId: new Types.ObjectId(coffeeId),
    status: "ACTIVE",
  };
  if (typeof tableNumber === "number") match.tableNumber = tableNumber;

  const rows = await TableSessionModel.aggregate([
    { $match: match },
    {
      $lookup: {
        from: "orders",
        localField: "_id",
        foreignField: "tableSessionId",
        as: "orders",
      },
    },
    // Sessions without any order must still show up in the table list.
    { $unwind: { path: "$orders", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$tableNumber",
        sessionIds: { $addToSet: "$_id" },
        openedAt: { $min: "$openedAt" },
        lastOrderAt: { $max: "$lastOrderAt" },
        orders: { $push: "$orders" },
      },
    },
    { $sort: { _id: 1 } },
  ]).exec();

  return rows.map((row) => ({
    tableNumber: Number(row._id),
    sessionIds: (row.sessionIds ?? []) as Types.ObjectId[],
    openedAt: row.openedAt as Date,
    lastOrderAt: row.lastOrderAt as Date,
    orders: ((row.orders ?? []) as Array<TableOrderDoc | null>).filter(
      (order): order is TableOrderDoc => order !== null && order !== undefined,
    ),
  }));
}

/** Every table currently open in the coffee, with its orders. */
export async function listCoffeeTables(coffeeId: string): Promise<CoffeeTableRow[]> {
  return aggregateTables(coffeeId);
}

/** One table of the coffee, with the orders of its active sessions. */
export async function listCoffeeTable(coffeeId: string, tableNumber: number): Promise<CoffeeTableRow | null> {
  const [row] = await aggregateTables(coffeeId, tableNumber);
  return row ?? null;
}

/**
 * Close every active session of a table.
 *
 * Returns the number of sessions closed so the caller can report it.
 */
export async function closeCoffeeTableSessions(
  coffeeId: string,
  tableNumber: number,
  closedAt = new Date(),
): Promise<number> {
  if (!Types.ObjectId.isValid(coffeeId)) return 0;
  const result = await TableSessionModel.updateMany(
    {
      coffeeId: new Types.ObjectId(coffeeId),
      tableNumber,
      status: "ACTIVE",
    },
    { $set: { status: "CLOSED", closedAt } },
    { runValidators: true },
  ).exec();
  return result.modifiedCount ?? 0;
}
