import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "../src/app.js";
import { seedDatabase } from "../src/db/seed.js";
import { mongoose } from "../src/db/index.js";
import { createAdminCoffee } from "../src/repositories/admin/coffee.repository.js";
import { setupTestDatabase, teardownTestDatabase, type TestDatabase } from "./helpers.js";
import type {
  AdminAuthDto,
  AdminCategoryDto,
  AdminCoffeeDto,
  AdminItemDto,
  CoffeeWithCategoriesDto,
} from "../src/types/index.js";

const APP_PIN = "3219";
const DEFAULT_COFFEE_PIN = "0000";

describe("Faza backoffice", () => {
  let testDb: TestDatabase;
  let app: Express;

  beforeAll(async () => {
    testDb = await setupTestDatabase();
    app = createApp();
    await seedDatabase();
  });

  beforeEach(async () => {
    await seedDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase(testDb);
  });

  // ---- helpers ------------------------------------------------------------

  async function appLogin(pin: string): Promise<request.Response> {
    return request(app).post("/api/v1/admin/auth/app").send({ pin });
  }

  async function coffeeLogin(slug: string, pin: string): Promise<request.Response> {
    return request(app).post(`/api/v1/admin/auth/coffee/${slug}`).send({ pin });
  }

  async function appToken(): Promise<string> {
    const response = await appLogin(APP_PIN);
    expect(response.status).toBe(200);
    return (response.body.data as AdminAuthDto).token;
  }

  async function coffeeToken(slug: string, pin: string = DEFAULT_COFFEE_PIN): Promise<string> {
    const response = await coffeeLogin(slug, pin);
    expect(response.status).toBe(200);
    return (response.body.data as AdminAuthDto).token;
  }

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];

  async function publicCoffee(slug: string): Promise<CoffeeWithCategoriesDto> {
    const response = await request(app).get(`/api/v1/coffees/${slug}`);
    expect(response.status).toBe(200);
    return response.body.data as CoffeeWithCategoriesDto;
  }

  async function coffeeIdOf(slug: string): Promise<string> {
    return (await publicCoffee(slug)).id;
  }

  async function categoryOf(slug: string, name: string): Promise<AdminCategoryDto["id"]> {
    const coffee = await publicCoffee(slug);
    const category = coffee.categories.find((candidate) => candidate.name === name);
    expect(category).toBeDefined();
    return category!.id;
  }

  // ---- auth (scenarios 1–4) ------------------------------------------------

  describe("admin authentication", () => {
    it("1. accepts the correct app admin PIN", async () => {
      const response = await appLogin(APP_PIN);
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const session = response.body.data as AdminAuthDto;
      expect(session.role).toBe("APP_ADMIN");
      expect(typeof session.token).toBe("string");
      expect(session.token.length).toBeGreaterThan(20);
      expect(session.expiresIn).toBeTruthy();
    });

    it("2. rejects an incorrect app admin PIN", async () => {
      const response = await appLogin("9999");
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ success: false, message: "Invalid PIN" });
    });

    it("3. accepts the correct coffee admin PIN and scopes the session", async () => {
      const response = await coffeeLogin("cafe-el-manzah", DEFAULT_COFFEE_PIN);
      expect(response.status).toBe(200);
      const session = response.body.data as AdminAuthDto;
      expect(session.role).toBe("COFFEE_ADMIN");
      expect(session.coffeeId).toBe(await coffeeIdOf("cafe-el-manzah"));
      expect(typeof session.token).toBe("string");
    });

    it("4. rejects an incorrect coffee admin PIN", async () => {
      const response = await coffeeLogin("cafe-el-manzah", "1111");
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ success: false, message: "Invalid PIN" });
    });

    it("rejects a PIN that is not 4 digits", async () => {
      const response = await appLogin("321");
      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Validation failed");
    });

    it("returns 404 for a coffee slug that does not exist", async () => {
      const response = await coffeeLogin("no-such-coffee", DEFAULT_COFFEE_PIN);
      expect(response.status).toBe(404);
      expect(response.body.message).toBe("Coffee not found");
    });
  });

  // ---- role gating ----------------------------------------------------------

  describe("role gating", () => {
    it("rejects admin routes without a token (401)", async () => {
      const response = await request(app).get("/api/v1/admin/coffees");
      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Unauthorized");
    });

    it("rejects an expired or invalid token (401)", async () => {
      const response = await request(app)
        .get("/api/v1/admin/coffees")
        .set(...bearer("not-a-valid-token"));
      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Unauthorized");
    });

    it("forbids a coffee admin from the app admin endpoints (403)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await request(app)
        .get("/api/v1/admin/coffees")
        .set(...bearer(token));
      expect(response.status).toBe(403);
    });

    it("forbids the app admin from the coffee admin endpoints (403)", async () => {
      const token = await appToken();
      const response = await request(app)
        .get("/api/v1/admin/my-coffee")
        .set(...bearer(token));
      expect(response.status).toBe(403);
    });
  });

  // ---- coffee admin: manage their own coffee (scenario 5) --------------------

  describe("coffee admin own-coffee operations", () => {
    it("5. can read and update their own coffee information", async () => {
      const token = await coffeeToken("cafe-el-manzah");

      const read = await request(app)
        .get("/api/v1/admin/my-coffee")
        .set(...bearer(token));
      expect(read.status).toBe(200);
      const mine = read.body.data as AdminCoffeeDto;
      expect(mine.slug).toBe("cafe-el-manzah");

      const update = await request(app)
        .patch("/api/v1/admin/my-coffee")
        .set(...bearer(token))
        .send({ name: "Café El Manzah V2" });
      expect(update.status).toBe(200);
      expect((update.body.data as AdminCoffeeDto).name).toBe("Café El Manzah V2");
    });

    it("saving settings with an unchanged slug does not 409", async () => {
      const token = await coffeeToken("cafe-el-manzah");

      const response = await request(app)
        .patch("/api/v1/admin/my-coffee")
        .set(...bearer(token))
        .send({ name: "Café El Manzah", logo: "https://example.com/logo.png", slug: "cafe-el-manzah" });
      expect(response.status).toBe(200);
      expect((response.body.data as AdminCoffeeDto).slug).toBe("cafe-el-manzah");
    });

    it("rejects changing the slug to another coffee's slug (409)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await request(app)
        .patch("/api/v1/admin/my-coffee")
        .set(...bearer(token))
        .send({ slug: "brew-and-beans" });
      expect(response.status).toBe(409);
    });

    it("can create, list, update and delete their own categories", async () => {
      const token = await coffeeToken("brew-and-beans");

      const created = await request(app)
        .post("/api/v1/admin/my-coffee/categories")
        .set(...bearer(token))
        .send({ name: "Snacks" });
      expect(created.status).toBe(201);
      const categoryId = (created.body.data as AdminCategoryDto).id;

      const list = await request(app)
        .get("/api/v1/admin/my-coffee/categories")
        .set(...bearer(token));
      expect(list.status).toBe(200);
      expect((list.body.data as AdminCategoryDto[]).map((category) => category.name)).toContain("Snacks");

      const updated = await request(app)
        .patch(`/api/v1/admin/my-coffee/categories/${categoryId}`)
        .set(...bearer(token))
        .send({ name: "Snacks & Sides" });
      expect(updated.status).toBe(200);
      expect((updated.body.data as AdminCategoryDto).name).toBe("Snacks & Sides");

      const deleted = await request(app)
        .delete(`/api/v1/admin/my-coffee/categories/${categoryId}`)
        .set(...bearer(token));
      expect(deleted.status).toBe(200);
    });

    it("cannot create two categories with the same name (409)", async () => {
      const token = await coffeeToken("brew-and-beans");
      const response = await request(app)
        .post("/api/v1/admin/my-coffee/categories")
        .set(...bearer(token))
        .send({ name: "Cafés" });
      expect(response.status).toBe(409);
    });

    it("can create, list, update and delete their own items", async () => {
      const token = await coffeeToken("coffee-leaf");
      const categoryId = await categoryOf("coffee-leaf", "Iced Drinks");

      const created = await request(app)
        .post(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
        .set(...bearer(token))
        .send({
          name: "Fruit Smoothie",
          description: "Mango and banana",
          price: 5.5,
          image: "https://example.com/smoothie.png",
        });
      expect(created.status).toBe(201);
      const itemId = (created.body.data as AdminItemDto).id;

      const list = await request(app)
        .get(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
        .set(...bearer(token));
      expect(list.status).toBe(200);
      expect((list.body.data as AdminItemDto[]).map((item) => item.name)).toContain("Fruit Smoothie");

      const updated = await request(app)
        .patch(`/api/v1/admin/my-coffee/items/${itemId}`)
        .set(...bearer(token))
        .send({ price: 6.0 });
      expect(updated.status).toBe(200);
      expect((updated.body.data as AdminItemDto).price).toBe(6.0);

      const deleted = await request(app)
        .delete(`/api/v1/admin/my-coffee/items/${itemId}`)
        .set(...bearer(token));
      expect(deleted.status).toBe(200);
    });

    it("validates item input (negative price → 400)", async () => {
      const token = await coffeeToken("coffee-leaf");
      const categoryId = await categoryOf("coffee-leaf", "Iced Drinks");
      const response = await request(app)
        .post(`/api/v1/admin/my-coffee/categories/${categoryId}/items`)
        .set(...bearer(token))
        .send({ name: "Bad Item", price: -1 });
      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Validation failed");
    });
  });

  // ---- coffee admin cannot touch another coffee (scenario 6, 11, 12) ----------

  describe("cross-coffee isolation for coffee admins", () => {
    it("6. coffee A admin cannot use any id belonging to coffee B", async () => {
      const tokenA = await coffeeToken("cafe-el-manzah");

      const brewCafes = await categoryOf("brew-and-beans", "Cafés");
      const brewCoffee = await publicCoffee("brew-and-beans");
      const brewCafesId = brewCoffee.categories.find((category) => category.name === "Cafés")!.id;

      // A knowing B's category ObjectId is not enough…
      const patchCategory = await request(app)
        .patch(`/api/v1/admin/my-coffee/categories/${brewCafesId}`)
        .set(...bearer(tokenA))
        .send({ name: "Hijacked" });
      expect(patchCategory.status).toBe(404);

      const deleteCategory = await request(app)
        .delete(`/api/v1/admin/my-coffee/categories/${brewCafesId}`)
        .set(...bearer(tokenA));
      expect(deleteCategory.status).toBe(404);

      // …nor B's item ObjectId.
      const brewItems = await request(app).get(`/api/v1/categories/${brewCafes}/items`);
      expect((brewItems.body.data as ItemDtoLike[]).length).toBeGreaterThan(0);
      const brewItemId = (brewItems.body.data as ItemDtoLike[])[0]!.id;

      const patchItem = await request(app)
        .patch(`/api/v1/admin/my-coffee/items/${brewItemId}`)
        .set(...bearer(tokenA))
        .send({ price: 999 });
      expect(patchItem.status).toBe(404);

      // Reading B's category items under A's session is also denied.
      const listItems = await request(app)
        .get(`/api/v1/admin/my-coffee/categories/${brewCafesId}/items`)
        .set(...bearer(tokenA));
      expect(listItems.status).toBe(404);
    });

    it("11. validates category ownership server-side", async () => {
      const tokenA = await coffeeToken("cafe-el-manzah");
      const brewCafesId = await categoryOf("brew-and-beans", "Cafés");

      const response = await request(app)
        .patch(`/api/v1/admin/my-coffee/categories/${brewCafesId}`)
        .set(...bearer(tokenA))
        .send({ name: "Stolen" });
      expect(response.status).toBe(404);
      expect(response.body.message).toBe("Category not found");
    });

    it("12. validates item ownership server-side", async () => {
      const tokenA = await coffeeToken("cafe-el-manzah");
      const brewItems = await request(app).get(
        `/api/v1/categories/${await categoryOf("brew-and-beans", "Cafés")}/items`,
      );
      const brewItemId = (brewItems.body.data as ItemDtoLike[]).find((item) => item.name === "Espresso")!.id;

      const response = await request(app)
        .patch(`/api/v1/admin/my-coffee/items/${brewItemId}`)
        .set(...bearer(tokenA))
        .send({ price: 0.01 });
      expect(response.status).toBe(404);
      expect(response.body.message).toBe("Item not found");
    });

    it("6b. ownership survives a category delete (items of the other coffee stay)", async () => {
      const tokenA = await coffeeToken("cafe-el-manzah");
      const brewCafesId = await categoryOf("brew-and-beans", "Cafés");

      // Trying to delete B's category must fail AND must not remove its items.
      await request(app)
        .delete(`/api/v1/admin/my-coffee/categories/${brewCafesId}`)
        .set(...bearer(tokenA));

      const after = await request(app).get(`/api/v1/categories/${brewCafesId}/items`);
      expect(after.status).toBe(200);
      expect((after.body.data as ItemDtoLike[]).length).toBeGreaterThan(0);
    });
  });

  // ---- app admin manages all coffees (scenario 7) -----------------------------

  describe("app admin coffee management", () => {
    it("7. can list, update and delete every coffee", async () => {
      const token = await appToken();

      const list = await request(app)
        .get("/api/v1/admin/coffees")
        .set(...bearer(token));
      expect(list.status).toBe(200);
      const coffees = list.body.data as AdminCoffeeDto[];
      expect(coffees.map((coffee) => coffee.slug)).toEqual(
        expect.arrayContaining(["cafe-el-manzah", "brew-and-beans", "coffee-leaf"]),
      );
      expect(coffees.find((coffee) => coffee.slug === "cafe-el-manzah")!.categoryCount).toBe(5);

      const manzahId = coffees.find((coffee) => coffee.slug === "cafe-el-manzah")!.id;
      const brewId = coffees.find((coffee) => coffee.slug === "brew-and-beans")!.id;

      const updateA = await request(app)
        .patch(`/api/v1/admin/coffees/${manzahId}`)
        .set(...bearer(token))
        .send({ name: "Café El Manzah (admin)" });
      expect(updateA.status).toBe(200);
      expect((updateA.body.data as AdminCoffeeDto).name).toBe("Café El Manzah (admin)");

      const updateB = await request(app)
        .patch(`/api/v1/admin/coffees/${brewId}`)
        .set(...bearer(token))
        .send({ name: "Brew & Beans (admin)" });
      expect(updateB.status).toBe(200);
    });

    it("create a coffee and verify its default admin PIN works (scenario 8)", async () => {
      const token = await appToken();

      const created = await request(app)
        .post("/api/v1/admin/coffees")
        .set(...bearer(token))
        .send({ name: "Café Ternat", logo: "https://example.com/ternat-logo.png" });
      expect(created.status).toBe(201);
      const coffee = created.body.data as AdminCoffeeDto;
      expect(coffee.slug).toBe("cafe-ternat");
      expect(coffee.categoryCount).toBe(0);

      // The new coffee is immediately accessible by its coffee admin with the
      // default PIN 0000 (hash-stored, verified through the normal flow).
      const login = await coffeeLogin(coffee.slug, DEFAULT_COFFEE_PIN);
      expect(login.status).toBe(200);
      expect((login.body.data as AdminAuthDto).coffeeId).toBe(coffee.id);
    });

    it("rejects a duplicate slug while creating (409)", async () => {
      const token = await appToken();
      const response = await request(app)
        .post("/api/v1/admin/coffees")
        .set(...bearer(token))
        .send({ name: "Café El Manzah 2", logo: "https://example.com/x.png", slug: "cafe-el-manzah" });
      expect(response.status).toBe(409);
    });

    it("can reset a coffee admin PIN back to 0000", async () => {
      const token = await appToken();
      const manzahId = await coffeeIdOf("cafe-el-manzah");

      // Change to a custom PIN first.
      const coffeeTokenA = await coffeeToken("cafe-el-manzah");
      const changed = await request(app)
        .patch("/api/v1/admin/my-coffee/pin")
        .set(...bearer(coffeeTokenA))
        .send({ currentPin: DEFAULT_COFFEE_PIN, newPin: "1234" });
      expect(changed.status).toBe(200);

      // Old default no longer works…
      const oldLogin = await coffeeLogin("cafe-el-manzah", DEFAULT_COFFEE_PIN);
      expect(oldLogin.status).toBe(401);

      // …new one does.
      const newLogin = await coffeeLogin("cafe-el-manzah", "1234");
      expect(newLogin.status).toBe(200);

      // App admin resets to 0000.
      const reset = await request(app)
        .patch(`/api/v1/admin/coffees/${manzahId}/pin`)
        .set(...bearer(token));
      expect(reset.status).toBe(200);

      // 1234 is dead, 0000 works again.
      expect((await coffeeLogin("cafe-el-manzah", "1234")).status).toBe(401);
      expect((await coffeeLogin("cafe-el-manzah", DEFAULT_COFFEE_PIN)).status).toBe(200);
    });
  });

  // ---- PIN changes (coffee admin) ----------------------------------------------

  describe("coffee admin PIN change", () => {
    it("rejects a wrong current PIN (401)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await request(app)
        .patch("/api/v1/admin/my-coffee/pin")
        .set(...bearer(token))
        .send({ currentPin: "1111", newPin: "4321" });
      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Invalid current PIN");
    });

    it("rejects newPin equal to currentPin (400)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await request(app)
        .patch("/api/v1/admin/my-coffee/pin")
        .set(...bearer(token))
        .send({ currentPin: DEFAULT_COFFEE_PIN, newPin: DEFAULT_COFFEE_PIN });
      expect(response.status).toBe(400);
    });

    it("rejects a non-4-digit new PIN (400)", async () => {
      const token = await coffeeToken("cafe-el-manzah");
      const response = await request(app)
        .patch("/api/v1/admin/my-coffee/pin")
        .set(...bearer(token))
        .send({ currentPin: DEFAULT_COFFEE_PIN, newPin: "12" });
      expect(response.status).toBe(400);
    });
  });

  // ---- PINs never appear in responses (scenario 9) --------------------------------

  describe("PIN secrecy", () => {
    it("9. never returns the PIN or its hash in any response", async () => {
      const token = await appToken();
      const manzahId = await coffeeIdOf("cafe-el-manzah");

      const create = await request(app)
        .post("/api/v1/admin/coffees")
        .set(...bearer(token))
        .send({ name: "Zéro Café", logo: "https://example.com/zero.png", slug: "zero-cafe" });

      const get = await request(app)
        .get(`/api/v1/admin/coffees/${manzahId}`)
        .set(...bearer(token));
      const getListed = await request(app)
        .get("/api/v1/admin/coffees")
        .set(...bearer(token));
      const myCoffee = await request(app)
        .get("/api/v1/admin/my-coffee")
        .set(...bearer(await coffeeToken("cafe-el-manzah")));
      const publicMenu = await request(app).get("/api/v1/coffees/cafe-el-manzah");

      for (const response of [create, get, getListed, myCoffee, publicMenu]) {
        const serialized = JSON.stringify(response.body);
        expect(serialized).not.toMatch(/adminpin|pinhash|"pin"/i);
      }
      expect(getListed.status).toBe(200);
    });

    it("9b. createAdminCoffee never returns the PIN hash on the row", async () => {
      const row = await createAdminCoffee({
        name: "Hash Guard Café",
        logo: "https://example.com/hash-guard.png",
        slug: "hash-guard",
        adminPinHash: "scrypt$fakeprehash$fakehash",
      });
      expect(row).not.toHaveProperty("adminPinHash");
      expect(Object.keys(row).sort()).toEqual([
        "_id",
        "categoryCount",
        "cover",
        "coverImageId",
        "createdAt",
        "logo",
        "logoImageId",
        "name",
        "slug",
        "updatedAt",
      ]);
    });
  });

  // ---- cascade deletes (scenarios 10, category cascade) ----------------------------

  describe("dependency-aware deletes", () => {
    it("10. deleting a coffee leaves no orphaned categories or items", async () => {
      const token = await appToken();
      const leaf = await publicCoffee("coffee-leaf");
      const leafId = leaf.id;
      const leafCategoryIds = leaf.categories.map((category) => category.id);
      const itemCountBefore = await countItemsInCategories(leafCategoryIds);
      expect(itemCountBefore).toBeGreaterThan(0);

      const deleted = await request(app)
        .delete(`/api/v1/admin/coffees/${leafId}`)
        .set(...bearer(token));
      expect(deleted.status).toBe(200);

      // Public routes now 404 for anything under that coffee.
      expect((await request(app).get("/api/v1/coffees/coffee-leaf")).status).toBe(404);

      // No orphan rows remain in the database.
      expect(await countCategoriesOf(leafId)).toBe(0);
      expect(await countItemsInCategories(leafCategoryIds)).toBe(0);

      // Direct lookups by a stale category id must also be gone.
      for (const categoryId of leafCategoryIds) {
        expect((await request(app).get(`/api/v1/categories/${categoryId}/items`)).status).toBe(404);
      }
    });

    it("deleting a category removes its items but not the coffee", async () => {
      const token = await coffeeToken("brew-and-beans");
      const brewCafesId = await categoryOf("brew-and-beans", "Cafés");

      const deleted = await request(app)
        .delete(`/api/v1/admin/my-coffee/categories/${brewCafesId}`)
        .set(...bearer(token));
      expect(deleted.status).toBe(200);

      expect((await request(app).get(`/api/v1/categories/${brewCafesId}/items`)).status).toBe(404);
      expect((await request(app).get("/api/v1/coffees/brew-and-beans")).status).toBe(200);
    });
  });
});

interface ItemDtoLike {
  id: string;
  name: string;
}

async function countItemsInCategories(categoryIds: string[]): Promise<number> {
  if (categoryIds.length === 0) return 0;
  const categories = (await mongoose.connection
    .collection("itemcategories")
    .find({ _id: { $in: categoryIds.map((id) => new mongoose.Types.ObjectId(id)) } })
    .project({ _id: 1 })
    .toArray()) as { _id: mongoose.Types.ObjectId }[];
  const ids = categories.map((category) => category._id);
  return ids.length === 0
    ? 0
    : mongoose.connection.collection("items").countDocuments({ itemCategoryId: { $in: ids } });
}

async function countCategoriesOf(coffeeId: string): Promise<number> {
  return mongoose.connection
    .collection("itemcategories")
    .countDocuments({ coffeeId: new mongoose.Types.ObjectId(coffeeId) });
}
