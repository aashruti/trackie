import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Shared by the Next.js server (DAL) and standalone scripts (seed/reconcile).
// The `server-only` guard lives on the DAL modules, not here, so tsx scripts can
// import the client without tripping it.
const client = postgres(process.env.DATABASE_URL!, { max: 5 });
export const db = drizzle(client, { schema });
