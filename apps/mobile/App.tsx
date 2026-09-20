import { Text, View } from "react-native";
import { slugify } from "@repo/core";
import { createProjectInput, type Project } from "@repo/schema";
import type { AppRouter } from "@repo/server/router";

type ListOutput = AppRouter["projects"]["list"];

export default function App() {
  const parsed = createProjectInput.safeParse({ name: "From Metro" });
  const fake: Pick<Project, "name"> = { name: slugify("From Metro") };
  return (
    <View>
      <Text>{fake.name}</Text>
      <Text>{parsed.success ? "valid" : "invalid"}</Text>
      <Text>contract typed: {typeof (undefined as unknown as ListOutput)}</Text>
    </View>
  );
}
