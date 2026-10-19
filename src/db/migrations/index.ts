import type { Db, MongoClient } from "mongodb";

export interface MigrationContext {
  /** The target database for this migration. */
  db: Db;
  /** Raw driver client (for anything the Db handle can't express). */
  client: MongoClient;
}

export interface Migration {
  /** Identifier used for ordering and changelog tracking. Must be unique. */
  name: string;
  up: (context: MigrationContext) => Promise<void>;
  /** Optional rollback. Keep destructive steps documented. */
  down?: (context: MigrationContext) => Promise<void>;
}

/**
 * Ordered list of database migrations.
 * Migrations run in declaration order and are recorded in the managed
 * `_migrations` collection, so each runs exactly once per database.
 *
 * IMPORTANT: never reorder or rename an already-applied migration.
 * Add new ones at the end instead.
 */
export const migrations: Migration[] = [
  // Added over time by appending entries here.
];
