import { Service } from "./lib.js";
import { nowA } from "./impl-a.js";

export function runA(): unknown {
  return new Service({ now: nowA }).run();
}
