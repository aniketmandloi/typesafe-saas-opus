import { restoreSession } from "@repo/auth-expo";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { authClient } from "../auth.ts";

export default function RootLayout() {
  // Load-bearing, and the third sanctioned call site of the #10545 workaround.
  //
  // Sign-in and sign-up each refetch the session they just created; nothing
  // refetched the session a *previous* run stored, so a cold start showed a
  // signed-out app to a signed-in user. Remove this and the session comes back
  // only after the user signs in again — which, since the cookie is still
  // valid, looks like the app forgetting them at random.
  useEffect(() => {
    void restoreSession(authClient);
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack />
    </>
  );
}
