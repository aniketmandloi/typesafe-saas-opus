import { insertProjectSchema } from "@repo/schema";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Button, Text, TextInput, View } from "react-native";

import { createMobileClient } from "../trpc.ts";

/**
 * The Project *as a client sees it*, which is not the Project in the schema.
 *
 * `createdAt` is a `Date` in Drizzle and arrives here as a `string`, because
 * JSON has no date and the contract carries no transformer. tRPC infers that
 * honestly, so the type is right — but it means the kit has two shapes for one
 * value and has never decided which is canonical at the edge. Raised as its own
 * ticket rather than settled here.
 *
 * Reading the shape off `AppRouter` instead of off `@repo/schema` is the
 * correct client idiom either way: it is what the wire actually delivers, and
 * it stays correct whichever way that ticket goes.
 */
// Read off the client rather than off `inferRouterOutputs`, which lives in
// `@trpc/server` — a package a native app has no business depending on, even
// for a type that erases.
type MobileClient = ReturnType<typeof createMobileClient>;
type Project = Awaited<ReturnType<MobileClient["projects"]["list"]["query"]>>[number];

export default function ProjectsScreen() {
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setProjects(await createMobileClient(organizationId).projects.list.query());
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    // The same validator the server runs and the web form runs. `@repo/schema`
    // is universal, so this is one declaration reaching three places rather
    // than three that agree by convention (#2).
    const parsed = insertProjectSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid");
      return;
    }
    setError(null);
    await createMobileClient(organizationId).projects.create.mutate(parsed.data);
    setName("");
    await load();
  };

  return (
    <View style={{ padding: 16, gap: 8 }}>
      {projects.map((project) => (
        <Text key={project.id}>{project.name}</Text>
      ))}
      <TextInput placeholder="New project" value={name} onChangeText={setName} />
      <Button title="Create" onPress={() => void create()} />
      {error ? <Text>{error}</Text> : null}
    </View>
  );
}
