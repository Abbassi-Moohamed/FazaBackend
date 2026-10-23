import type { OfferStatus } from "../models/offer.model.js";

/** One component of an offer, priced from the live menu. */
export interface OfferLineDto {
  itemId: string;
  name: string;
  image: string | null;
  quantity: number;
  /** Current selling price of a single component (promotion included). */
  unitPrice: number;
}

/** The offer as shown on the public menu. */
export interface FeaturedOfferDto {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image: string | null;
  /** Sum of the components at their current selling price. */
  originalPrice: number;
  /** `originalPrice - price`, never negative. */
  savings: number;
  stock: number;
  startAt: Date | null;
  endAt: Date | null;
  status: OfferStatus;
  lines: OfferLineDto[];
}

/** The offer as managed in the backoffice. */
export interface AdminOfferDto extends FeaturedOfferDto {
  isActive: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
