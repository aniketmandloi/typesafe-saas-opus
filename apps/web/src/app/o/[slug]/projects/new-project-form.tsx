"use client";

import { insertProjectSchema } from "@repo/validators";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createBrowserClient } from "../../../../trpc/browser.ts";

/**
 * A mutation, and deliberately not a Server Action (ADR-0003).
 *
 * `apps/web` may not import server packages, so the only legal Server Action
 * would be a wrapper calling tRPC over HTTP — a third mutation path that exists
 * on web and not on mobile. One contract exists so both clients do the same
 * thing. The genuine loss is form ergonomics: no `useActionState`, no
 * progressive enhancement, no no-JS submission, judged acceptable for B2B SaaS
 * behind an auth wall.
 */
export const NewProjectForm = ({ organizationId }: { organizationId: string }) => {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    // The same schema the server validates the mutation with — `@repo/schema`
    // is universal, so this is not a second declaration of the rule (#2).
    const parsed = insertProjectSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid");
      return;
    }

    setError(null);
    await createBrowserClient(organizationId).projects.create.mutate(parsed.data);
    setName("");
    router.refresh();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label>
        New project
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button type="submit">Create</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
};
