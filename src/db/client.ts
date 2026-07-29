import "@tanstack/react-start/server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL environment variable.");
  }
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

let _db: ReturnType<typeof createDb> | undefined;

export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_, prop, receiver) {
    if (!_db) _db = createDb();
    return Reflect.get(_db, prop, receiver);
  },
});
