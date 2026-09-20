import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./auth-schema.ts";

const db = drizzle("postgres://localhost:5432/never-connected");

const auth = betterAuth({
  secret: "probe-secret-that-is-at-least-32-chars-long-ok",
  baseURL: "http://localhost:3000",
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  plugins: [organization()],
  logger: { level: "error" },
});

const ctx = await auth.$context;
if (!ctx.checkSchema) {
  console.log("RESULT: no checkSchema on context");
  process.exit(2);
}
try {
  await ctx.checkSchema();
  console.log("RESULT: PASS — declaration satisfies Better Auth 1.7.5");
} catch (err) {
  console.log("RESULT: REJECT —", (err as Error).constructor.name);
  console.log((err as Error).message);
  process.exit(1);
}
