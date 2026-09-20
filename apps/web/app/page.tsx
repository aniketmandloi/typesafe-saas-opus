import { slugify } from "@repo/core";
import { createProjectInput, type Project } from "@repo/schema";
import type { AppRouter } from "@repo/server/router";

// type-only use of the contract, the one thing web shares with the server
type ListOutput = AppRouter["projects"]["list"];

export default function Page() {
  const parsed = createProjectInput.safeParse({ name: "From Next" });
  const fake: Pick<Project, "name"> = { name: slugify("From Next") };
  return (
    <main>
      <h1>{fake.name}</h1>
      <p>{parsed.success ? "valid" : "invalid"}</p>
      <p>contract typed: {typeof (undefined as unknown as ListOutput)}</p>
    </main>
  );
}
