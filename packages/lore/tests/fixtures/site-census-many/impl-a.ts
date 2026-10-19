import { err, type Res } from "./lib.js";

export function nowA(): Res {
  return err({ code: "A_ONLY" });
}
