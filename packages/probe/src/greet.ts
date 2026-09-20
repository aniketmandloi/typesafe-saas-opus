export type Who = { name: string };
export const greet = (w: Who): string => `hello ${w.name}`;
