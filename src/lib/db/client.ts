import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema";
import { log } from "../logger";

/**
 * DATABASE CONNECTION
 *
 * - No DATABASE_URL  → embedded PostgreSQL (PGlite) saved in ./data/pglite.
 *   Nothing to install; your data survives restarts.
 * - DATABASE_URL set → a normal PostgreSQL server.
 *
 * Both use the same schema and the same migration files in ./drizzle.
 * Migrations are applied automatically the first time the app touches the DB.
 */

// Both drivers expose the same query API; we use the PGlite type as the shared type.
export type Db = PgliteDatabase<typeof schema>;

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

type DbHolder = { promise?: Promise<Db>; close?: () => Promise<void> };

// Stored on globalThis so Next.js hot-reload doesn't open the database twice
// (two PGlite instances on the same folder would corrupt it).
const holder: DbHolder = ((globalThis as Record<string, unknown>).__fashionDb ??= {}) as DbHolder;

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const pool = new Pool({ connectionString: url, max: 10 });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER });
    holder.close = () => pool.end();
    log.info("Database: connected to PostgreSQL server (DATABASE_URL).");
    return db as unknown as Db;
  }

  const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.PGLITE_DIR?.trim() || "./data/pglite");
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  holder.close = () => client.close();
  log.info(`Database: embedded PostgreSQL (PGlite) ready.`);
  return db;
}

export function getDb(): Promise<Db> {
  if (!holder.promise) {
    holder.promise = open().catch((err) => {
      holder.promise = undefined; // allow a later retry
      throw err;
    });
  }
  return holder.promise;
}

/** In-memory database for automated tests (fresh and empty every time). */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}
