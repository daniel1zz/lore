import { err, type Res } from "./lib.js";

export function nowB(): Res {
  return err({ code: "B_ONLY" });
}
