import { probe } from "@repo/probe";
import { LOCAL_WEB } from "./local.ts";
import { Badge } from "./Badge.tsx";

export default function Page() {
  return <main>{probe("turbopack")} / {LOCAL_WEB} <Badge text="tsx-web-ok" /></main>;
}
