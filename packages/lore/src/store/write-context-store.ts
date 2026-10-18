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
 *   - The NAME SOURCE (D11, BR-1032) is stored on the audit row as `details.name_source`
 *     (`flag|env|mcp|session|worktree|os`) — no schema change. It is stamped only when the row's `actor`
 *     equals `ctx.identity.claimed`: a row written under a different actor (an explicit per-call name)
 *     must not inherit a source that describes another name. Renders read it back from `details`.
 *   - Rule-registry writes (`allocateRuleAndUpdateLeaf`, `moveRule`) build their version row INSIDE the
 *     store, so the run is carried in as a parameter (`harnessRun` / `RuleLeafPatch.harness_run`).
 *   - {@link readWriteContext} lets a service that must DECIDE an author when its caller gave none
 *     (CorpusService, handoff) read the context of the store it was handed.
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

import { ok, type LoreError, type Result } from "@lore/core";
import { resolveActorWithSource } from "@lore/core/node";
import { readOsUsername } from "../os-username.js";
import { verifyInvocationIdentity } from "../service/run-identity-verify.js";
import type { AuditEntry, InvocationIdentity, VersionRecord } from "@lore/core";

/**
 * What the decorator reads from a write context. Structurally satisfied by core's `WriteContext`
 * (`harnessRun: RunId | null` is assignable to `string | null`); declared as plain strings so a caller holding a
 * run id as an unbranded string (tests, MCP arguments) needs no cast.
 */
export interface StampingContext {
  readonly identity: {
    readonly harnessRun: string | null;
    readonly claimed: string;
    readonly claimedSource: string;
  };
}
import type { StoreInterface } from "./store-interface.js";

type Stamp = { harness_run: string | null };

/** Argument positions (0-based) holding a VersionRecord / AuditEntry, per stamped method. */
interface StampedArgs {
  readonly version?: number;
  readonly audit?: number;
  /** Position of a `ProvenanceWriteExtras` whose `also_audit` entries are stamped too. */
  readonly extras?: number;
  /** Positions of `RuleLeafPatch` arguments whose `harness_run` is stamped. */
  readonly patches?: readonly number[];
  /** Position of a trailing `harnessRun: string | null` parameter that receives the run. */
  readonly harnessRunArg?: number;
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
  allocateRuleAndUpdateLeaf: { harnessRunArg: 5 },
  reserveProposedRuleAndUpdateSpec: { harnessRunArg: 3 },
  moveRule: { patches: [1, 2] },
};

/** Contexts of the stores {@link withWriteContext} returned (WeakMap: no change to `StoreInterface`). */
const CONTEXT_BY_STORE = new WeakMap<object, StampingContext>();

/** The {@link StampingContext} a store was wrapped with, or `undefined` for an unwrapped store. */
export function readWriteContext(store: StoreInterface): StampingContext | undefined {
  return CONTEXT_BY_STORE.get(store);
}

/**
 * The author of a write: the explicit `by` when given, else the claimed name of the store's write context
 * (the invocation identity), else the env chain (session → OS user) for an unwrapped store.
 * ⛔ Every service that writes an audit row MUST resolve its actor here, never by an independent
 * `resolveActorWithSource` call: a second resolution can disagree with the invocation's name (gate rows once
 * read the OS user next to a `--by` claim).
 */
export function resolveWriteActorFor(store: StoreInterface, by?: string): string {
  if (by !== undefined) return actorFromProcessTiers(by);
  return readWriteContext(store)?.identity.claimed ?? actorFromProcessTiers(undefined);
}

/**
 * The env-chain tiers (explicit > session > OS user) for a store with NO write context.
 *
 * reason: a visible, counted process read (AS-26 ledger) rather than a threaded value: the services that call
 * `resolveWriteActorFor` are constructed bare (`new CorpusService(store)`) by hundreds of tests and by the HTTP/MCP
 * read paths, none of which has an Invocation to inject, so failing loud here would break every unwrapped write
 * instead of naming it. Goes away when every store is built with a write context (IV-7/8).
 */
function actorFromProcessTiers(by: string | undefined): string {
  return resolveActorWithSource(by, process.env, readOsUsername).actor;
}

function stampRecord<T extends object>(record: T, stamp: Stamp): T {
  return { ...record, ...stamp };
}

function stampAudit(entry: AuditEntry, stamp: Stamp, ctx: StampingContext): AuditEntry {
  const stamped = stampRecord(entry, stamp);
  if (entry.actor !== ctx.identity.claimed) return stamped;
  return { ...stamped, details: { ...entry.details, name_source: ctx.identity.claimedSource } };
}

/** Wrap `store` so every provenance write carries `ctx.identity.harnessRun`. */
export function withWriteContext(store: StoreInterface, ctx: StampingContext): StoreInterface {
  const wrapped: StoreInterface = new Proxy(store, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      const bound = (value as (...a: unknown[]) => unknown).bind(target);
      const spec = typeof prop === "string" ? STAMPED[prop] : undefined;
      if (spec === undefined) return bound;
      return (...args: unknown[]) => {
        // reason: read per call (not once at wrap time) so `withVerifiedWriteContext` can downgrade an unknown
        // run to null after its one-time registry lookup without rebuilding the proxy.
        const stamp: Stamp = { harness_run: ctx.identity.harnessRun };
        const next = [...args];
        if (spec.version !== undefined) next[spec.version] = stampRecord(args[spec.version] as VersionRecord, stamp);
        if (spec.audit !== undefined) next[spec.audit] = stampAudit(args[spec.audit] as AuditEntry, stamp, ctx);
        if (spec.extras !== undefined) {
          const extras = args[spec.extras] as { also_audit?: readonly AuditEntry[] } | undefined;
          if (extras?.also_audit !== undefined) {
            next[spec.extras] = { ...extras, also_audit: extras.also_audit.map((a) => stampAudit(a, stamp, ctx)) };
          }
        }
        for (const position of spec.patches ?? []) {
          next[position] = stampRecord(args[position] as object, stamp);
        }
        if (spec.harnessRunArg !== undefined) next[spec.harnessRunArg] = stamp.harness_run;
        return bound(...next);
      };
    },
  });
  CONTEXT_BY_STORE.set(wrapped, ctx);
  return wrapped;
}

/** Sink for the one-per-write-context warning about an unregistered `--harness-run` id (CLI: stderr). */
export type UnknownRunWarn = (line: string) => void;

/** Per wrapped store: resolves (once) to the VERIFIED identity — same object the stamps are read from. */
const VERIFIERS = new WeakMap<object, () => Promise<Result<InvocationIdentity, LoreError>>>();

/**
 * The verified invocation identity of a store wrapped by {@link withVerifiedWriteContext}: runs the one-time
 * run lookup if it has not happened yet (no second warning) and returns the identity the store stamps rows
 * with — `harnessRun` null when the claimed run is unregistered. `ok(undefined)` for an unwrapped store.
 */
export function ensureVerifiedIdentity(store: StoreInterface): Promise<Result<InvocationIdentity | undefined, LoreError>> {
  const verifier = VERIFIERS.get(store);
  return verifier === undefined ? Promise.resolve(ok(undefined)) : verifier();
}

/**
 * {@link withWriteContext} plus the D7 run check via {@link verifyInvocationIdentity}: the claimed run is
 * verified ONCE (first stamped write, or an explicit {@link ensureVerifiedIdentity}), and the stamps are read
 * from the verified value. An unregistered id → `harness_run` NULL, name and source kept, one `warn` line. A
 * failing lookup is returned as the write's own error (no silent downgrade). Non-stamped methods are not delayed.
 *
 * @param onVerified - Called once with the verified identity (the CLI uses it to replace its process slot).
 */
export function withVerifiedWriteContext(
  store: StoreInterface,
  identity: InvocationIdentity,
  warn: UnknownRunWarn,
  onVerified?: (verified: InvocationIdentity) => void,
): StoreInterface {
  const live: { identity: InvocationIdentity } = { identity };
  const inner = withWriteContext(store, live);
  let verified: Promise<Result<InvocationIdentity, LoreError>> | undefined;
  const verifyOnce = (): Promise<Result<InvocationIdentity, LoreError>> => {
    verified ??= verifyInvocationIdentity(store, identity, warn).then((result) => {
      if (result.ok) {
        live.identity = result.value;
        onVerified?.(result.value);
      }
      return result;
    });
    return verified;
  };
  const outer: StoreInterface = new Proxy(inner, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function" || typeof prop !== "string" || STAMPED[prop] === undefined) return value;
      return async (...args: unknown[]) => {
        const check = await verifyOnce();
        if (!check.ok) return check;
        return (value as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  CONTEXT_BY_STORE.set(outer, live);
  VERIFIERS.set(outer, verifyOnce);
  return outer;
}
