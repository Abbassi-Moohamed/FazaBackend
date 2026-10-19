import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "../src/app.js";
import { seedDatabase } from "../src/db/seed.js";
import { mongoose } from "../src/db/index.js";
import { setupTestDatabase, teardownTestDatabase, type TestDatabase } from "./helpers.js";
import type { CoffeeWithCategoriesDto, ItemDto } from "../src/types/index.js";

describe("Faza public API", () => {
  let testDb: TestDatabase;
  let app: Express;

  beforeAll(async () => {
    testDb = await setupTestDatabase();
    app = createApp();
    await seedDatabase();
  });

  beforeEach(async () => {
    // Re-seed before every test so tests are independent of each other.
    await seedDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase(testDb);
  });

  const names = (categories: { name: string }[]): string[] => categories.map((category) => category.name).sort();

  async function categoryItems(categoryId: string): Promise<ItemDto[]> {
    const response = await request(app).get(`/api/v1/categories/${categoryId}/items`);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    return response.body.data as ItemDto[];
  }

  describe("health", () => {
    it("GET / returns the API overview", async () => {
      const response = await request(app).get("/");
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("Faza API");
      expect(response.body.data.endpoints.coffeeBySlug).toBe("/api/v1/coffees/:coffeeSlug");
    });

    it("GET /health returns ok", async () => {
      const response = await request(app).get("/health");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ok" });
    });

    it("GET /health/ready reports the database is up", async () => {
      const response = await request(app).get("/health/ready");
      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
      expect(response.body.database).toBe("up");
    });
  });

  describe("GET /api/v1/coffees/:coffeeSlug", () => {
    it("resolves a coffee with only its own categories", async () => {
      const response = await request(app).get("/api/v1/coffees/cafe-el-manzah");
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const data = response.body.data as CoffeeWithCategoriesDto;
      expect(data.id).toMatch(/^[a-f0-9]{24}$/i);
      expect(data.name).toBe("Café El Manzah");
      expect(data.slug).toBe("cafe-el-manzah");
      expect(data.logo).toContain("https://");

      expect(names(data.categories)).toEqual(["Boissons chaudes", "Cafés", "Desserts", "Jus", "Petit-déjeuner"]);
      for (const category of data.categories) {
        expect(category.id).toMatch(/^[a-f0-9]{24}$/i);
        expect(category.itemCount).toBeGreaterThanOrEqual(0);
        // The advertised count must match what the items endpoint returns.
        const items = await categoryItems(category.id);
        expect(category.itemCount).toBe(items.length);
      }
    });

    it("is case-insensitive on the slug (normalized to lowercase)", async () => {
      const response = await request(app).get("/api/v1/coffees/CAFE-EL-MANZAH");
      expect(response.status).toBe(200);
      expect(response.body.data.slug).toBe("cafe-el-manzah");
    });

    it("never mixes categories between coffees", async () => {
      const manzah = await request(app).get("/api/v1/coffees/cafe-el-manzah");
      const brew = await request(app).get("/api/v1/coffees/brew-and-beans");
      const leaf = await request(app).get("/api/v1/coffees/coffee-leaf");

      expect(manzah.status).toBe(200);
      expect(brew.status).toBe(200);
      expect(leaf.status).toBe(200);

      const manzahCategories = names(manzah.body.data.categories);
      const brewCategories = names(brew.body.data.categories);
      const leafCategories = names(leaf.body.data.categories);

      // Same-named categories exist on different coffees…
      expect(manzahCategories).toContain("Cafés");
      expect(brewCategories).toContain("Cafés");
      expect(manzahCategories).toContain("Jus");
      expect(brewCategories).toContain("Jus");

      // …but each coffee only sees its own.
      expect(manzahCategories).toEqual(["Boissons chaudes", "Cafés", "Desserts", "Jus", "Petit-déjeuner"]);
      expect(brewCategories).toEqual(["Bakery", "Cafés", "Jus"]);
      expect(leafCategories).toEqual(["Brunch", "Hot Coffees", "Iced Drinks", "Tea Selection"]);

      expect(manzahCategories).not.toContain("Bakery");
      expect(manzahCategories).not.toContain("Brunch");
      expect(leafCategories).not.toContain("Cafés");
    });

    it("returns 404 for an unknown slug", async () => {
      const response = await request(app).get("/api/v1/coffees/no-such-coffee");
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ success: false, message: "Coffee not found" });
    });

    it("returns 400 for a malformed slug", async () => {
      const response = await request(app).get("/api/v1/coffees/Caf%C3%A9_el_manzah!");
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Validation failed");
      expect(Array.isArray(response.body.details)).toBe(true);
      expect(response.body.details[0].field).toBe("params.coffeeSlug");
    });
  });

  describe("GET /api/v1/categories/:categoryId/items", () => {
    it("returns only the items of the requested category", async () => {
      const coffee = (await request(app).get("/api/v1/coffees/cafe-el-manzah")).body.data as CoffeeWithCategoriesDto;
      const cafes = coffee.categories.find((category) => category.name === "Cafés");
      expect(cafes).toBeDefined();

      const items = await categoryItems(cafes!.id);
      expect(items.map((item) => item.name).sort()).toEqual(["Café Crème", "Cappuccino", "Espresso"]);

      const espresso = items.find((item) => item.name === "Espresso");
      expect(espresso).toMatchObject({
        description: "Café espresso traditionnel",
        price: 2.5,
      });
      expect(espresso!.id).toMatch(/^[a-f0-9]{24}$/i);
      expect(espresso!.image).toContain("https://");
    });

    it("keeps same-named categories of different coffees isolated", async () => {
      // Café El Manzah's "Cafés" category.
      const manzah = (await request(app).get("/api/v1/coffees/cafe-el-manzah")).body.data as CoffeeWithCategoriesDto;
      const manzahCafes = manzah.categories.find((category) => category.name === "Cafés")!;

      // Brew & Beans' "Cafés" category.
      const brew = (await request(app).get("/api/v1/coffees/brew-and-beans")).body.data as CoffeeWithCategoriesDto;
      const brewCafes = brew.categories.find((category) => category.name === "Cafés")!;

      expect(manzahCafes.id).not.toBe(brewCafes.id);

      const manzahItems = await categoryItems(manzahCafes.id);
      const brewItems = await categoryItems(brewCafes.id);

      expect(manzahItems.map((item) => item.name)).toEqual(expect.arrayContaining(["Cappuccino", "Café Crème"]));
      expect(brewItems.map((item) => item.name)).not.toContain("Cappuccino");
      expect(brewItems.map((item) => item.name).sort()).toEqual(["Americano", "Espresso"]);
    });

    it("returns 404 for a category that does not exist", async () => {
      const missingId = new mongoose.Types.ObjectId().toString();
      const response = await request(app).get(`/api/v1/categories/${missingId}/items`);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ success: false, message: "Category not found" });
    });

    it("returns 400 for a malformed category id", async () => {
      const response = await request(app).get("/api/v1/categories/not-an-objectid/items");
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.details[0].field).toBe("params.categoryId");
    });
  });

  describe("error envelope & CORS", () => {
    it("returns a consistent 404 envelope for unknown routes", async () => {
      const response = await request(app).get("/api/v1/does-not-exist");
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("Route not found");
      expect(response.body.stack).toBeUndefined();
    });

    it("allows the configured frontend origin", async () => {
      const response = await request(app).get("/api/v1/coffees/cafe-el-manzah").set("Origin", "http://localhost:3000");
      expect(response.status).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    });

    it("rejects unknown origins with a 403 envelope", async () => {
      const response = await request(app).get("/api/v1/coffees/cafe-el-manzah").set("Origin", "https://evil.example");
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ success: false, message: "Origin not allowed by CORS" });
    });

    it("never leaks internals in error responses", async () => {
      const response = await request(app).get("/api/v1/coffees/no-such-coffee");
      const body = response.body as Record<string, unknown>;
      expect(body.stack).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/mongodb|process\.env|DATABASE_URL/i);
    });
  });
});
