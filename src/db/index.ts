import mongoose from "mongoose";

/**
 * Central database access. The URI comes from the environment
 * (DATABASE_URL); nothing here knows about credentials.
 *
 * Indexes are managed by migrations (`npm run db:migrate`),
 * so autoIndex is disabled on the driver.
 */
export async function connectDatabase(uri: string): Promise<void> {
  await mongoose.connect(uri, {
    autoIndex: false,
    serverSelectionTimeoutMS: 5_000,
  });
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export { mongoose };
