/**
 * API data-transfer objects and request input shapes. Kept independent from
 * Mongoose documents.
 */

export interface CategoryDto {
  id: string;
  name: string;
  image: string | null;
  /** Total items currently in this category (including unavailable ones). */
  itemCount: number;
}

export interface CoffeeWithCategoriesDto {
  id: string;
  name: string;
  logo: string;
  cover: string | null;
  slug: string;
  categories: CategoryDto[];
}

export interface ItemDto {
  id: string;
  name: string;
  description: string | null;
  price: number;
  promotion: number | null;
  isAvailable: boolean;
  image: string | null;
}

/** The two administrator levels of the Faza backoffice. */
export type AdminRole = "APP_ADMIN" | "COFFEE_ADMIN";

/**
 * Authorization context attached to a request by the auth middleware after a
 * valid bearer token is verified. For COFFEE_ADMIN it always carries the id
 * of the single coffee the admin is allowed to manage — never trust a body
 * `coffeeId` past this point.
 */
export interface AdminContext {
  role: AdminRole;
  coffeeId?: string;
}

export interface AdminAuthDto {
  token: string;
  role: AdminRole;
  /** Present only for COFFEE_ADMIN sessions. */
  coffeeId?: string;
  /** Token lifetime in jsonwebtoken notation (e.g. "12h"). */
  expiresIn: string;
}

export interface AdminCoffeeDto {
  id: string;
  name: string;
  logo: string;
  cover: string | null;
  slug: string;
  categoryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminCategoryDto {
  id: string;
  name: string;
  image: string | null;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminItemDto {
  id: string;
  name: string;
  description: string | null;
  price: number;
  promotion: number | null;
  isAvailable: boolean;
  image: string | null;
  itemCategoryId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** An image uploaded to Cloudflare R2. Only metadata is returned/stored. */
export interface AdminImageDto {
  imageId: string;
  url: string;
}

/** Request body shape shared by the app-admin and coffee-admin coffee edits. */
export interface CoffeeUpdateInput {
  name?: string;
  logo?: string;
  cover?: string;
  slug?: string;
}

export type { OrderStatus } from "../models/order.model.js";
export type { OrderDto, OrderItemDto } from "./order.js";
export type {
  AnalyticsDto,
  InsightComparison,
  InsightKpis,
  InsightTopItem,
  InsightCategory,
  InsightPromotionSummary,
  InsightAvailability,
} from "./insights.js";
