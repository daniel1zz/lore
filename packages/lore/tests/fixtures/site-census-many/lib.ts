// Shared by every entry closure: the product error constructor and an injected-dependency service.
export type Res = { ok: boolean; code?: string };
export const err = (e: { code: string; field?: string }): Res => ({ ok: false, code: e.code });

export interface ServiceDeps {
  readonly now: () => Res;
}

/** Calls an injected function: what `now` is bound to differs per entry closure. */
export class Service {
  constructor(private readonly deps: ServiceDeps) {}
  run(): Res {
    if (this.deps.now().ok) return err({ code: "SHARED_REFUSAL" });
    return { ok: true };
  }
}
