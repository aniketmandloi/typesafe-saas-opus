"use client";

import { TRPCClientError } from "@trpc/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createBrowserClient } from "../../../trpc/browser.ts";

// Accepting is not tenant-scoped — it is the mutation that *creates* the
// membership scoping is made of — so the header value here is never read. It is
// passed because the client is built per Organization and there is no
// Organization yet.
const NO_ORGANIZATION = "";

type State = "idle" | "accepted" | "needs-account" | "gone";

export const AcceptInvitation = ({ invitationId }: { invitationId: string }) => {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");

  const accept = async () => {
    try {
      await createBrowserClient(NO_ORGANIZATION).members.accept.mutate({ invitationId });
      setState("accepted");
      router.push("/");
    } catch (cause) {
      const code =
        cause instanceof TRPCClientError
          ? (cause.data as { code?: string } | undefined)?.code
          : undefined;
      // UNAUTHORIZED is the server saying "no session", which is the signal to
      // sign up and come back — not an error to show. Everything else reads as
      // gone, because the server refuses to distinguish expired, already-used
      // and not-yours (#12).
      setState(code === "UNAUTHORIZED" ? "needs-account" : "gone");
    }
  };

  return (
    <main>
      <h1>Join the organization</h1>
      {state === "idle" ? (
        <button type="button" onClick={() => void accept()}>
          Accept invitation
        </button>
      ) : null}
      {state === "needs-account" ? (
        <p>
          <a href={`/?invitation=${encodeURIComponent(invitationId)}`}>
            Sign in or sign up first, then open this link again.
          </a>
        </p>
      ) : null}
      {state === "gone" ? <p role="alert">This invitation is no longer available.</p> : null}
      {state === "accepted" ? <p>Joined.</p> : null}
    </main>
  );
};
