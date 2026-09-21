import type { ExpoConfig } from "expo/config";

import { publicEnv } from "./src/env.ts";

// An entrypoint in the glossary's sense (ADR-0006): the earliest hook on this
// platform that runs with a real environment, before anything depending on it
// is bundled.
//
// The import above *is* the gate. `src/env.ts` parses at module scope, so a
// missing `EXPO_PUBLIC_API_URL` fails the build here rather than inlining as
// `undefined` and crashing on a device.
export const APP_SCHEME = "typesafesaas";

const config: ExpoConfig = {
  name: "Typesafe SaaS Kit",
  slug: "typesafe-saas-kit",
  scheme: APP_SCHEME,
  version: "0.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: { supportsTablet: true, bundleIdentifier: "dev.typesafesaas.kit" },
  android: { package: "dev.typesafesaas.kit" },
  plugins: ["expo-router", "expo-secure-store"],
  experiments: { typedRoutes: true },
  extra: {
    // Echoed into the manifest so `expo config` shows what the build baked in.
    // Not read at runtime: the bundle has the inlined value.
    apiUrl: publicEnv.apiUrl,
  },
};

export default config;
