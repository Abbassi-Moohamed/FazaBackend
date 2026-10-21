import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { env } from "../config/env.js";
import { connectDatabase, disconnectDatabase, mongoose } from "./index.js";
import "./migrations/0001_init.js";
import "./migrations/0002_admin.js";
import "./migrations/0003_images.js";
import "./migrations/0004_category_images.js";
import "./migrations/0005_coffee_cover_images.js";
import "./migrations/0006_item_availability_promotion.js";
import "./migrations/0007_orders.js";
import "./migrations/0008_order_contract.js";
import "./migrations/0009_table_sessions_service_shifts.js";
import "./migrations/0010_order_payment.js";
import "./migrations/0011_item_category_name_index.js";
import "./migrations/0012_multiple_sessions_per_table.js";
import { migrations } from "./migrations/index.js";
import { logger } from "../utils/logger.js";

/**
 * Applies every pending migration in order and records it in the managed
 * `_migrations` changelog collection. Idempotent: each migration runs
 * exactly once per database.
 */
export async function runMigrations(): Promise<string[]> {
  const client = mongoose.connection.getClient();
  const db = client.db();
  const changelog = db.collection("_migrations");
  const appliedNames = new Set(
    (
      await changelog
        .find({ name: { $exists: true } })
        .project({ name: 1 })
        .toArray()
    ).map((doc) => doc.name as string),
  );

  const executed: string[] = [];
  for (const migration of migrations) {
    if (appliedNames.has(migration.name)) continue;
    await migration.up({ db, client });
    await changelog.insertOne({ name: migration.name, appliedAt: new Date() });
    logger.info({ migration: migration.name }, "Migration applied");
    executed.push(migration.name);
  }
  return executed;
}

async function main(): Promise<void> {
  await connectDatabase(env.DATABASE_URL);
  const applied = await runMigrations();
  logger.info({ applied }, "Migrations up to date");
  await disconnectDatabase();
}

const isDirectRun = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((error: unknown) => {
    logger.error(error, "Migration run failed");
    process.exitCode = 1;
  });
}
