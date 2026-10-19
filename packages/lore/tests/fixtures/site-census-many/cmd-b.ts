import { Service } from "./lib.js";
import { nowB } from "./impl-b.js";
// deliberately unresolvable: only this entry's closure may report it
// @ts-ignore
import "./missing-module.js";

export function runB(): unknown {
  return new Service({ now: nowB }).run();
}
