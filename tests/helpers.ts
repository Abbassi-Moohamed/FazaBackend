import { MongoMemoryServer } from "mongodb-memory-server";
import { mongoose } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";

export interface TestDatabase {
  server: MongoMemoryServer;
  uri: string;
}

/**
 * Boots an in-memory MongoDB, connects Mongoose to it and applies the
 * real migration chain. Each test suite gets a fully isolated database.
 */
export async function setupTestDatabase(): Promise<TestDatabase> {
  const server = await MongoMemoryServer.create();
  const uri = server.getUri("faza-test");

  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 5_000 });
  await runMigrations();

  return { server, uri };
}

export async function teardownTestDatabase(database: TestDatabase): Promise<void> {
  await mongoose.disconnect();
  await database.server.stop();
}