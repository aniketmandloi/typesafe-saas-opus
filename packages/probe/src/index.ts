import { greet } from "./greet.ts";
import type { Who } from "./greet.ts";
import { NESTED } from "./deep/nested.ts";

export const probe = (name: string): string => {
  const who: Who = { name };
  return `${greet(who)} / ${NESTED}`;
};
