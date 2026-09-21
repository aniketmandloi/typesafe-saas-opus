"use client";

import { useState } from "react";

import { authClient } from "../auth-client.ts";

export const SignInForm = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (mode: "in" | "up") => {
    setPending(true);
    setError(null);
    const result =
      mode === "in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Sign-in failed.");
      return;
    }
    // A full reload rather than a router refresh: the session cookie has just
    // changed, and every RSC read on the next render has to be made with it.
    window.location.reload();
  };

  return (
    <main>
      <h1>Sign in</h1>
      <label>
        Name (sign up only)
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button type="button" disabled={pending} onClick={() => submit("in")}>
        Sign in
      </button>
      <button type="button" disabled={pending} onClick={() => submit("up")}>
        Sign up
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
};
