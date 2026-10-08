// Fixture for AC-BLS2-5 — not compiled into the product, not a test.
import { Service } from "./service.js";

export function runCommand(svc: Service, kind: string, n: number) {
  return svc.process(kind, n);
}
