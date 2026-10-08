// Fixture for AC-BLS2-5 (interface dispatch) — not compiled into the product, not a test.
import type { CappedStore, Res } from "./store.js";

export class CapService {
  constructor(private readonly store: CappedStore) {}

  add(n: number): Res {
    this.store.insertCapped(n);
    return this.store.insertCapped(n + 1);
  }
}

export function runCapped(svc: CapService, n: number): Res {
  return svc.add(n);
}
