import type { Request, Response } from "express";
import {
  archiveOffer,
  createOffer,
  listOffers,
  updateOffer,
  type CreateOfferInput,
  type UpdateOfferInput,
} from "../../services/admin/offer.service.js";
import { sendSuccess } from "../../utils/http.js";

export async function listMyOffersController(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await listOffers(req.admin!.coffeeId!));
}

export async function createMyOfferController(req: Request, res: Response): Promise<void> {
  const body = req.validated!.body as CreateOfferInput;
  sendSuccess(res, await createOffer(req.admin!.coffeeId!, body), 201);
}

export async function updateMyOfferController(req: Request, res: Response): Promise<void> {
  const { offerId } = req.validated!.params as { offerId: string };
  const body = req.validated!.body as UpdateOfferInput;
  sendSuccess(res, await updateOffer(req.admin!.coffeeId!, offerId, body));
}

export async function archiveMyOfferController(req: Request, res: Response): Promise<void> {
  const { offerId } = req.validated!.params as { offerId: string };
  sendSuccess(res, await archiveOffer(req.admin!.coffeeId!, offerId));
}
