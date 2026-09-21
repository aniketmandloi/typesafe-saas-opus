import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Button, Text, View } from "react-native";

import { createMobileClient } from "../../trpc.ts";

/**
 * The deep-link half of the invite flow.
 *
 * Reachable at `typesafesaas://invitations/<id>`. **The email does not send
 * that URL** — it sends the web one, because a single link has to work for a
 * recipient who has never heard of the app. Turning that web URL into an
 * app-opening universal link needs an `apple-app-site-association` file hosted
 * on the API's domain and a real Apple team id, which is deployment work this
 * slice does not do. So this route is registered and correct, and today it is
 * reached by hand.
 *
 * Accepting is not tenant-scoped — it is the mutation that *creates* the
 * membership scoping is made of — so the org header is empty and unread.
 */
const NO_ORGANIZATION = "";

type State = "idle" | "accepted" | "needs-account" | "gone";

export default function AcceptInvitationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<State>("idle");

  const accept = async () => {
    try {
      await createMobileClient(NO_ORGANIZATION).members.accept.mutate({ invitationId: id });
      setState("accepted");
      router.replace("/organizations");
    } catch (cause) {
      // UNAUTHORIZED means "no session", which is the signal to sign in and
      // come back — not an error to show. Everything else reads as gone,
      // because the server refuses to distinguish expired, already-used and
      // not-yours: an invitation id is a bearer token that arrived by email.
      const code = (cause as { data?: { code?: string } })?.data?.code;
      setState(code === "UNAUTHORIZED" ? "needs-account" : "gone");
    }
  };

  return (
    <View style={{ padding: 16, gap: 8 }}>
      <Text>Join the organization</Text>
      {state === "idle" ? <Button title="Accept invitation" onPress={() => void accept()} /> : null}
      {state === "needs-account" ? (
        <Button title="Sign in first, then reopen the link" onPress={() => router.push("/")} />
      ) : null}
      {state === "gone" ? <Text>This invitation is no longer available.</Text> : null}
      {state === "accepted" ? <Text>Joined.</Text> : null}
    </View>
  );
}
