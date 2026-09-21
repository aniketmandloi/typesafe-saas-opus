"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createBrowserClient } from "../../../../trpc/browser.ts";

export const InviteForm = ({ organizationId }: { organizationId: string }) => {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await createBrowserClient(organizationId).members.invite.mutate({ email, role });
      setEmail("");
      // The first invite clears `isPersonal` on this Organization, in place. A
      // refresh is how the switcher and the member list notice (#3).
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invite failed.");
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label>
        Invite by email
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Role
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as "admin" | "member")}
        >
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <button type="submit">Invite</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
};
