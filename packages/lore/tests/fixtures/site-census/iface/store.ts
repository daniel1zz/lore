// Fixture for AC-BLS2-5 (interface dispatch) — not compiled into the product, not a test.
export type Res = { ok: boolean; code?: string };
const err = (e: { code: string }): Res => ({ ok: false, code: e.code });

/** The refusal lives behind this interface: the caller only sees the type, never the class. */
export interface CappedStore {
  insertCapped(n: number): Res;
}

export class SqlCappedStore implements CappedStore {
  insertCapped(n: number): Res {
    if (n > 10) {
      return err({ code: "CAP_FULL" });
    }
    return { ok: true };
  }
}
