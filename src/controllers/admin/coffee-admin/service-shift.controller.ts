import type { Request, Response } from "express";
import {
  finishServiceShift,
  finishCurrentServiceShift,
  getCoffeeTableSession,
  getCoffeeTableSessions,
  getCurrentServiceShift,
  getServiceShift,
  getServiceShifts,
  finishTableSession,
  openServiceShift,
} from "../../../services/service-shift.service.js";
import { sendSuccess } from "../../../utils/http.js";

const coffeeId = (req: Request) => req.admin!.coffeeId!;

export async function getCurrentShiftController(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getCurrentServiceShift(coffeeId(req)));
}

export async function openShiftController(req: Request, res: Response): Promise<void> {
  const body = req.validated!.body as {
    name?: string;
    type?: "MORNING" | "AFTERNOON" | "CUSTOM";
    label?: string;
    notes?: string;
  };
  sendSuccess(res, await openServiceShift(coffeeId(req), body), 201);
}

export async function listShiftsController(req: Request, res: Response): Promise<void> {
  const query = req.validated!.query as { status?: "OPEN" | "CLOSED"; page: number; limit: number };
  sendSuccess(res, await getServiceShifts(coffeeId(req), query.status, query.page, query.limit));
}

export async function getShiftController(req: Request, res: Response): Promise<void> {
  const { shiftId } = req.validated!.params as { shiftId: string };
  sendSuccess(res, await getServiceShift(coffeeId(req), shiftId));
}

export async function closeShiftController(req: Request, res: Response): Promise<void> {
  const { shiftId } = req.validated!.params as { shiftId: string };
  sendSuccess(res, await finishServiceShift(coffeeId(req), shiftId));
}

export async function closeCurrentShiftController(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await finishCurrentServiceShift(coffeeId(req)));
}

export async function listTableSessionsController(req: Request, res: Response): Promise<void> {
  const query =
    (req.validated?.query as
      { serviceShiftId?: string; status?: "ACTIVE" | "CLOSED"; page?: number; limit?: number } | undefined) ?? {};
  const params = req.validated?.params as { shiftId?: string } | undefined;
  sendSuccess(
    res,
    await getCoffeeTableSessions(coffeeId(req), {
      ...query,
      page: query.page ?? 1,
      limit: query.limit ?? 50,
      serviceShiftId: params?.shiftId ?? query.serviceShiftId,
    }),
  );
}

export async function getTableSessionController(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.validated!.params as { sessionId: string };
  sendSuccess(res, await getCoffeeTableSession(coffeeId(req), sessionId));
}

export async function closeTableSessionController(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.validated!.params as { sessionId: string };
  sendSuccess(res, await finishTableSession(coffeeId(req), sessionId));
}
