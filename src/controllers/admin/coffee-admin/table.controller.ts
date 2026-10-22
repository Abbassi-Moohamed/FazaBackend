import type { Request, Response } from "express";
import { closeCoffeeTable, getCoffeeTables } from "../../../services/table.service.js";
import { sendSuccess } from "../../../utils/http.js";

const coffeeId = (req: Request) => req.admin!.coffeeId!;

export async function listTablesController(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getCoffeeTables(coffeeId(req)));
}

export async function closeTableController(req: Request, res: Response): Promise<void> {
  const { tableNumber } = req.validated!.params as { tableNumber: number };
  sendSuccess(res, await closeCoffeeTable(coffeeId(req), tableNumber));
}
