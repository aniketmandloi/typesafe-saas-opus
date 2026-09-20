import { slugify } from "@repo/core";
import { projects } from "@repo/schema";
import { createProjectInput } from "@repo/schema";

const parsed = createProjectInput.safeParse({ name: "Hello World" });
console.log("node", process.version);
console.log("@repo/core slugify:", slugify("Hello World"));
console.log("@repo/schema table:", Object.keys(projects).length > 0 ? "loaded" : "empty");
console.log("zod validation:", parsed.success);
