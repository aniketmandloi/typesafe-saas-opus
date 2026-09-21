import { signInWithEmail, signUpWithEmail } from "@repo/auth-expo";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";

import { authClient } from "../auth.ts";

/**
 * Sign in, and the one place better-auth#10545 is visible in this app.
 *
 * The screen calls `signInWithEmail` from `@repo/auth-expo` rather than
 * `authClient.signIn.email` directly, because that wrapper carries the
 * `refetch()` the bug makes necessary. Calling the client straight would
 * compile, run, and leave the user looking signed out until the app restarts.
 */
export default function SignInScreen() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (mode: "in" | "up") => {
    setError(null);
    const result =
      mode === "in"
        ? await signInWithEmail(authClient, { email, password })
        : await signUpWithEmail(authClient, { email, password, name });
    if (result.error) {
      setError(result.error.message ?? "Sign-in failed.");
      return;
    }
    router.push("/organizations");
  };

  return (
    <View style={{ padding: 16, gap: 8 }}>
      <Text>{session ? `Signed in as ${session.user.email}` : "Sign in"}</Text>
      {/* A restored session is only worth restoring if it lets the user in:
          without this, a signed-in user is looking at a password field. No
          redirect, because this screen is also where signing in as someone
          else has to be possible. */}
      {session ? <Button title="Continue" onPress={() => router.push("/organizations")} /> : null}
      <TextInput placeholder="Name (sign up only)" value={name} onChangeText={setName} />
      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        // Not decoration: React Native defaults `autoCapitalize` to
        // "sentences", so an iOS keyboard capitalises the first character of a
        // typed password and the server answers INVALID_EMAIL_OR_PASSWORD for
        // a password the user typed correctly. A browser has no such keyboard,
        // so no web test can catch this.
        autoCapitalize="none"
        autoCorrect={false}
        value={password}
        onChangeText={setPassword}
      />
      <Button title="Sign in" onPress={() => void submit("in")} />
      <Button title="Sign up" onPress={() => void submit("up")} />
      {error ? <Text>{error}</Text> : null}
    </View>
  );
}
