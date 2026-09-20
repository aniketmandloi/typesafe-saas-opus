import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";

const db = drizzle("postgres://localhost:5432/never-connected");

export const auth = betterAuth({
  secret: "probe-secret-not-a-real-one",
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  plugins: [organization()],
});
