// @ts-nocheck reason: "@fx/core" resolves only inside a materialised fixture layout (node_modules link), not in the repo's own typecheck.
// Fixture for AC-BLS2-15 — not compiled into the product, not a test.
import { err, validateX, validateY } from "@fx/core";

export class Service {
  /** Two err() calls, SAME code, literal fields "a" and "b". */
  check(a: string, b: string) {
    if (a === "") return err({ code: "VALIDATION_ERROR", field: "a" });
    if (b === "") return err({ code: "VALIDATION_ERROR", field: "b" });
    return validateX(a);
  }

  /** Two err() calls, SAME code, NON-literal fields. */
  checkDynamic(first: string, second: string, v: string) {
    if (v === "1") return err({ code: "VALIDATION_ERROR", field: first });
    if (v === "2") return err({ code: "VALIDATION_ERROR", field: second });
    return validateY(Number(v));
  }
}
