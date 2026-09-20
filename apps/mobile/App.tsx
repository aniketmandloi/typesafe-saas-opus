import { View } from "react-native";
import { probe } from "@repo/probe";
import { LOCAL_MOBILE } from "./app/local.ts";
import { Badge } from "./app/Badge.tsx";
import { PLAT as PLAT_EXPLICIT } from "./app/plat.ts";
import { PLAT as PLAT_BARE } from "./app/plat";

export default function App() {
  return (
    <View>
      <Badge text={`${probe("metro")} / ${LOCAL_MOBILE} / tsx-mobile-ok`} />
      <Badge text={`explicit=${PLAT_EXPLICIT} bare=${PLAT_BARE}`} />
    </View>
  );
}
