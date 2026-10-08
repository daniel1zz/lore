// @ts-nocheck reason: "@fx/core" resolves only inside a materialised fixture layout (node_modules link), not in the repo's own typecheck.
// Fixture for AC-BLS2-15 — not compiled into the product, not a test.
import type { FxError } from "@fx/core";
import { Service } from "./service.js";

export function runCli(args: { id?: string; a: string; b: string; v: string }) {
  if (args.id === undefined) {
    // CLI usage refusal: an object of the product error type, never passed through err().
    const refusal: FxError = { code: "USAGE_ERROR", message: "--id is required" };
    process.exitCode = 2;
    return refusal;
  }
  const svc = new Service();
  svc.check(args.a, args.b);
  return svc.checkDynamic(args.a, args.b, args.v);
}
