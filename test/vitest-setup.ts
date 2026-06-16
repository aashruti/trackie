import { config } from "dotenv";

// Load local DB credentials for integration tests (DAL hits Postgres).
config({ path: ".env.local" });
