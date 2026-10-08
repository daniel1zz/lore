// Fixture for AC-BLS2-5 — not compiled into the product, not a test.
type Result = { ok: boolean; code?: string };
const err = (e: { code: string }): Result => ({ ok: false, code: e.code });
const gateFailure = (e: { code: string }): Result => ({ ok: false, code: e.code });
const isReady = (n: number) => n > 0;

const handlers: Record<string, (n: number) => Result> = {
  a: () => ({ ok: true }),
  b: () => ({ ok: true }),
};

export class Service {
  process(kind: string, n: number): Result {
    if (n < 0) {
      return err({ code: "NEGATIVE_INPUT" });
    }
    if (n === 0) {
      return err({ code: "ZERO_INPUT" });
    }
    if (n > 100) {
      return err({ code: "TOO_LARGE" });
    }
    if (!isReady(n)) {
      return gateFailure({ code: "GATE_NOT_READY" });
    }
    return handlers[kind]!(n);
  }
}
