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
 *     comes from the carrier, never from a service building the row.
 *   - ⛔ A stamped write whose identity has no known party (no run, no name) is REFUSED before the underlying store
 *     is called: `VALIDATION_ERROR` naming `lore session start --human <name>` and `lore setup` (BR-1351). Nothing
 *     is written, so no row is ever "unattested".
 *   - The NAME SOURCE (BR-1032) is stored on the audit row as `details.name_source`
 *     (`run|human|api-key|dashboard`) — no schema change. It is stamped only when the row's `actor`
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

import { AsyncLocalStorage } from "node:async_hooks";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { refusalNamingHowToBecomeKnown, UnknownPartyError } from "@lore/core/node";
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
    readonly claimed: string | null;
    readonly claimedSource: string | null;
    /** Present when `claimed` is null: why the invocation has no name for its writer. */
    readonly unresolvedReason?: string;
  };
}
import type { ProvenanceWriteExtras, StoreInterface } from "./store-interface.js";

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
  assignOrdinalForRepairWithProvenance: { version: 2, audit: 3 },
  softDeleteWithProvenance: { version: 1, audit: 2 },
  addLinkWithProvenance: { audit: 1 },
  setDocParentWithProvenance: { audit: 2 },
  allocateRuleAndUpdateLeaf: { harnessRunArg: 5 },
  reserveProposedRuleAndUpdateSpec: { harnessRunArg: 3 },
  moveRule: { patches: [1, 2] },
};

/** Contexts of the stores {@link withWriteContext} returned (WeakMap: no change to `StoreInterface`). */
const CONTEXT_BY_STORE = new WeakMap<object, StampingContext>();

/**
 * The identity of the ONE request an HTTP server is answering. A server process is one long-lived App serving many
 * callers (a bearer key, a dashboard login), so a write's party is a per-request fact, never the server's own
 * identity (BR-1055): the HTTP adapter registers the key's or the login's run and runs the request inside
 * {@link runWithRequestIdentity}; every stamped write below reads it first.
 */
const REQUEST_IDENTITY = new AsyncLocalStorage<StampingContext["identity"]>();

/**
 * Run `body` with `identity` as the write party of every store write made inside it (same async call tree).
 * The caller guarantees the identity's run is registered (HTTP registers it just before).
 */
export function runWithRequestIdentity<T>(identity: StampingContext["identity"], body: () => T): T {
  return REQUEST_IDENTITY.run(identity, body);
}

/** The identity a write is made under right now: the request's, when one is running, else the context's own. */
function effectiveIdentity(ctx: StampingContext): StampingContext["identity"] {
  return REQUEST_IDENTITY.getStore() ?? ctx.identity;
}

/** The refusal text of a write whose identity has no known party (BR-1351): names how to become one. */
function unknownPartyMessage(identity: StampingContext["identity"]): string {
  return identity.unresolvedReason ?? refusalNamingHowToBecomeKnown("This write has no attested agent run and no open human session.");
}

/** The refusal of a write whose identity has no known party; VALIDATION_ERROR -> exit 4, nothing written. */
function refusalOfUnknownParty(identity: StampingContext["identity"]): LoreError {
  return new UnknownPartyError(unknownPartyMessage(identity)).loreError;
}

/** The {@link StampingContext} a store was wrapped with, or `undefined` for an unwrapped store. */
export function readWriteContext(store: StoreInterface): StampingContext | undefined {
  return CONTEXT_BY_STORE.get(store);
}

/**
 * Test-only: declare the author of the writes a bare (unwrapped) `store` receives, so a service constructed over it
 * resolves the same name a CLI invocation would claim. It records the context WITHOUT wrapping the store: nothing is
 * stamped, and the store object a test holds stays the one it built. Never called from production code — every
 * production composition builds its store with a real write context.
 *
 * @param store - the bare store a unit test hands to a service
 * @param claimed - the author name its writes carry
 * @returns the same `store`
 */
export function declareWriteActorForTests<T extends StoreInterface>(store: T, claimed: string): T {
  CONTEXT_BY_STORE.set(store, { identity: { harnessRun: null, claimed, claimedSource: "human" } });
  return store;
}

/**
 * Thrown by {@link resolveWriteActorFor} when a write names no author and its store carries no write context: the
 * composition that built the service did not hand it an identity. A wiring defect, never a caller error — nothing
 * may guess an author from the process. `error` is the `LoreError` an adapter can render.
 */
export class WriteActorUnresolvedError extends Error {
  readonly error: LoreError;
  constructor() {
    const message =
      "no author for this write: the call gave no `by` and its store has no write context — build the app with an Invocation " +
      "(`createApp(dbPath, config, ambient, { identity })`) so the claimed name reaches the write";
    super(message);
    this.name = "WriteActorUnresolvedError";
    this.error = { code: "VALIDATION_ERROR", field: "actor", message };
  }
}

/**
 * The author of a write: the explicit `by` when given, else the claimed name of the store's write context
 * (the invocation identity). ⛔ Fails loud ({@link WriteActorUnresolvedError}) when neither exists, and
 * ({@link UnknownPartyError}) when the identity has no known party — never reads the process.
 * ⛔ Every service that writes an audit row MUST resolve its actor here, never by an independent
 * resolution: a second resolution can disagree with the invocation's name (gate rows once
 * read the OS user next to a `--by` claim).
 */
export function resolveWriteActorFor(store: StoreInterface, by?: string): string {
  if (by !== undefined && by.trim() !== "") return by;
  const context = readWriteContext(store);
  if (context === undefined) throw new WriteActorUnresolvedError();
  const identity = effectiveIdentity(context);
  // reason: the entry recorded "no known party" as a value so reads proceed; THIS is the point a write needs an actor.
  if (identity.claimed === null) throw new UnknownPartyError(unknownPartyMessage(identity));
  return identity.claimed;
}

/**
 * The known party's name for a READ-side observability row (a trace of `lore get` / `lore search`), or `undefined`
 * when the store's context has NO known party. Reads are never refused for identity (BR-1351), so the caller skips
 * the advisory trace row instead of failing.
 *
 * @throws {WriteActorUnresolvedError} when the store has no write context at all: that is a wiring defect, never
 *   "no party", and stays loud exactly as {@link resolveWriteActorFor} does.
 */
export function findTraceActorFor(store: StoreInterface): string | undefined {
  const context = readWriteContext(store);
  if (context === undefined) throw new WriteActorUnresolvedError();
  return effectiveIdentity(context).claimed ?? undefined;
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
        // reason: read per call (not once at wrap time): `withVerifiedWriteContext` replaces `ctx.identity` after its
        // one-time registry lookup, and an HTTP request runs under its own identity (`runWithRequestIdentity`).
        const identity = effectiveIdentity(ctx);
        // reason: BR-1351 — a write with no known party is refused HERE, the one chokepoint every stamped write
        // passes, before the underlying store sees it, so nothing is written (no version, no audit row).
        if (identity.claimed === null || identity.harnessRun === null) return Promise.resolve(err(refusalOfUnknownParty(identity)));
        const stamp: Stamp = { harness_run: identity.harnessRun };
        const callCtx: StampingContext = { identity };
        const next = [...args];
        if (spec.version !== undefined) next[spec.version] = stampRecord(args[spec.version] as VersionRecord, stamp);
        if (spec.audit !== undefined) next[spec.audit] = stampAudit(args[spec.audit] as AuditEntry, stamp, callCtx);
        if (spec.extras !== undefined) {
          const extras = args[spec.extras] as ProvenanceWriteExtras | undefined;
          if (extras?.also_audit !== undefined || extras?.also_update !== undefined) {
            next[spec.extras] = {
              ...extras,
              ...(extras.also_audit !== undefined ? { also_audit: extras.also_audit.map((a) => stampAudit(a, stamp, callCtx)) } : {}),
              // reason: BR-1307 — a companion doc write carries its own version and audit rows; they are
              // attributed to the run exactly like the primary write's.
              ...(extras.also_update !== undefined
                ? {
                    also_update: extras.also_update.map((c) => ({
                      ...c,
                      version: stampRecord(c.version, stamp),
                      audit: stampAudit(c.audit, stamp, callCtx),
                    })),
                  }
                : {}),
            };
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

/** Per wrapped store: resolves (once) to the VERIFIED identity — same object the stamps are read from. */
const VERIFIERS = new WeakMap<object, () => Promise<Result<InvocationIdentity, LoreError>>>();

/**
 * The verified invocation identity of a store wrapped by {@link withVerifiedWriteContext}: runs the one-time
 * run lookup if it has not happened yet and returns the identity the store stamps rows with; an unregistered run is
 * an error (BR-1351), never a downgrade. `ok(undefined)` for an unwrapped store.
 */
export function ensureVerifiedIdentity(store: StoreInterface): Promise<Result<InvocationIdentity | undefined, LoreError>> {
  const verifier = VERIFIERS.get(store);
  return verifier === undefined ? Promise.resolve(ok(undefined)) : verifier();
}

/**
 * {@link withWriteContext} plus the run check via {@link verifyInvocationIdentity}: the claimed run is verified
 * ONCE (first stamped write, or an explicit {@link ensureVerifiedIdentity}) and a run the registry does not know
 * refuses the write (exit 4) — never recorded unattested. A failing lookup is returned as the write's own error.
 * Non-stamped methods are not delayed. A write made inside {@link runWithRequestIdentity} (HTTP) is made under that
 * request's already-registered party and does not wait on the server process's own identity.
 *
 * @param onVerified - Called once with the verified identity (the CLI uses it to replace its process slot).
 */
export function withVerifiedWriteContext(
  store: StoreInterface,
  identity: InvocationIdentity,
  // reason: the unregistered-run WARNING is retired (an unregistered run is refused, BR-1351), so this sink is never
  // written to. The parameter stays only because `app.ts` — held by another task's live claim when this change
  // landed — still passes it positionally at its two call sites; drop it with that call-site edit.
  _retiredWarn: (line: string) => void,
  onVerified?: (verified: InvocationIdentity) => void,
): StoreInterface {
  const live: { identity: InvocationIdentity } = { identity };
  const inner = withWriteContext(store, live);
  let verified: Promise<Result<InvocationIdentity, LoreError>> | undefined;
  const verifyOnce = (): Promise<Result<InvocationIdentity, LoreError>> => {
    verified ??= verifyInvocationIdentity(store, identity).then((result) => {
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
        if (REQUEST_IDENTITY.getStore() === undefined) {
          const check = await verifyOnce();
          if (!check.ok) return check;
        }
        return (value as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  CONTEXT_BY_STORE.set(outer, live);
  VERIFIERS.set(outer, verifyOnce);
  return outer;
}
