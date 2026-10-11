/**
 * `withWriteContext` — the single store-write chokepoint that stamps the harness run on provenance rows
 * (spec-run-identity-slice-1-harness-attested-runs-attested D3/D4, BR-1032).
 *
 * Public surface: {@link withWriteContext}.
 *
 * Invariants:
 *   - The returned store stamps `ctx.identity.harnessRun` onto EVERY audit entry and version record that
 *     passes through a write method that takes one: `appendAuditEntry`, `insertVersion`, and every
 *     composite (`insertWithProvenance`, `insertWithAllocatedOrdinalAndProvenance`, `updateWithProvenance`
 *     — including `extras.also_audit` —, `softDeleteWithProvenance`, `addLinkWithProvenance`,
 *     `setDocParentWithProvenance`). Stamping OVERWRITES any value the caller put on the record: the run
 *     comes from the carrier, never from a service building the row. A null `harnessRun` stamps NULL.
 *   - Everything else delegates untouched (reads, `insertRun`/`getRun`, rule-registry methods, lifecycle),
 *     with `this` bound to the underlying store. The underlying store is never mutated: an unwrapped
 *     store keeps stamping nothing.
 *   - ⛔ A NEW `StoreInterface` method that accepts an `AuditEntry` or `VersionRecord` MUST be added to
 *     {@link STAMPED} below, or its rows silently stay unattested. `write-context-store.bun.test.ts`-style
 *     coverage of the matrix (AC-RID-5) is what catches a missed one.
 *   - The audit hash chain is unaffected: `harness_run` is not part of `computeAuditEntryHash`'s payload.
 *
 * Side-effect class: pure wrapper (no I/O of its own).
 */

import type { AuditEntry, VersionRecord, WriteContext } from "@lore/core";
import type { StoreInterface } from "./store-interface.js";

type Stamp = { harness_run: string | null };

/** Argument positions (0-based) holding a VersionRecord / AuditEntry, per stamped method. */
interface StampedArgs {
  readonly version?: number;
  readonly audit?: number;
  /** Position of a `ProvenanceWriteExtras` whose `also_audit` entries are stamped too. */
  readonly extras?: number;
}

const STAMPED: Readonly<Record<string, StampedArgs>> = {
  appendAuditEntry: { audit: 0 },
  insertVersion: { version: 0 },
  insertWithProvenance: { version: 1, audit: 2 },
  insertWithAllocatedOrdinalAndProvenance: { version: 1, audit: 2 },
  updateWithProvenance: { version: 3, audit: 4, extras: 5 },
  softDeleteWithProvenance: { version: 1, audit: 2 },
  addLinkWithProvenance: { audit: 1 },
  setDocParentWithProvenance: { audit: 2 },
};

function stampRecord<T extends object>(record: T, stamp: Stamp): T {
  return { ...record, ...stamp };
}

/** Wrap `store` so every provenance write carries `ctx.identity.harnessRun`. */
export function withWriteContext(store: StoreInterface, ctx: WriteContext): StoreInterface {
  const stamp: Stamp = { harness_run: ctx.identity.harnessRun };
  return new Proxy(store, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      const bound = (value as (...a: unknown[]) => unknown).bind(target);
      const spec = typeof prop === "string" ? STAMPED[prop] : undefined;
      if (spec === undefined) return bound;
      return (...args: unknown[]) => {
        const next = [...args];
        if (spec.version !== undefined) next[spec.version] = stampRecord(args[spec.version] as VersionRecord, stamp);
        if (spec.audit !== undefined) next[spec.audit] = stampRecord(args[spec.audit] as AuditEntry, stamp);
        if (spec.extras !== undefined) {
          const extras = args[spec.extras] as { also_audit?: readonly AuditEntry[] } | undefined;
          if (extras?.also_audit !== undefined) {
            next[spec.extras] = { ...extras, also_audit: extras.also_audit.map((a) => stampRecord(a, stamp)) };
          }
        }
        return bound(...next);
      };
    },
  });
}
