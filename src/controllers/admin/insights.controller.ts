import type { Request, Response } from "express";
import { getInsights } from "../../services/insights.service.js";
import { sendSuccess } from "../../utils/http.js";

export async function getMyCoffeeInsightsController(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as
    { startDate?: string; endDate?: string; from?: string; to?: string; serviceShiftId?: string } | undefined;
  const startDate = query?.startDate ?? query?.from;
  const endDate = query?.endDate ?? query?.to;
  sendSuccess(res, await getInsights(req.admin!.coffeeId!, startDate, endDate, query?.serviceShiftId));
}

export async function getAdminCoffeeInsightsController(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as
    { startDate?: string; endDate?: string; from?: string; to?: string; serviceShiftId?: string } | undefined;
  const { coffeeId } = req.validated!.params as { coffeeId: string };
  const startDate = query?.startDate ?? query?.from;
  const endDate = query?.endDate ?? query?.to;
  sendSuccess(res, await getInsights(coffeeId, startDate, endDate, query?.serviceShiftId));
}

export async function getPlatformInsightsController(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as
    { startDate?: string; endDate?: string; from?: string; to?: string; serviceShiftId?: string } | undefined;
  sendSuccess(
    res,
    await getInsights(undefined, query?.startDate ?? query?.from, query?.endDate ?? query?.to, query?.serviceShiftId),
  );
}
