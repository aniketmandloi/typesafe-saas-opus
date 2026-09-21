import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Button, Text, View } from "react-native";

import { createMobileClient } from "../trpc.ts";

type Membership = {
  organizationId: string;
  slug: string;
  name: string;
  isPersonal: boolean;
};

// The same bridge the web app needs: the contract is id-shaped and navigation
// is not, so something has to resolve one to the other. On mobile it comes from
// navigation state rather than a URL segment, which is the only difference (#9).
export default function OrganizationsScreen() {
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No Organization is named yet, so the header is empty. `organizations.list`
    // is a protectedProcedure precisely because it is asked before one is.
    createMobileClient("")
      .organizations.list.query()
      .then(setMemberships)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not load organizations."),
      );
  }, []);

  if (error) return <Text>{error}</Text>;
  if (!memberships) return <Text>Loading…</Text>;

  return (
    <View style={{ padding: 16, gap: 8 }}>
      {memberships.map((membership) => (
        <Button
          key={membership.organizationId}
          title={membership.name}
          onPress={() =>
            router.push({
              pathname: "/projects",
              params: { organizationId: membership.organizationId },
            })
          }
        />
      ))}
    </View>
  );
}
