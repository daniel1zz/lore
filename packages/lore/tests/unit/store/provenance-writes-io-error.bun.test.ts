/**
 * Regression coverage for the Result-contract gap fixed alongside BUG-002's
 * atomic composite writes: `insertWithProvenance` / `updateWithProvenance` /
 * `softDeleteWithProvenance` used to issue `db.run("BEGIN IMMEDIATE")` BEFORE
 * their try/catch, so a SYNCHRONOUS bun:sqlite throw at that call (real-world
 * trigger: `SQLITE_IOERR_VNODE`, observed live via SPEC-078 T2's
 * multi-project mount probe) escaped as a raw JS exception instead of the
 * `Result<T, LoreError>` every `StoreInterface` method promises its callers.
 * `softDeleteWithProvenance` coverage was added in a follow-up scope
 * extension of the same task once the identical pre-try `BEGIN IMMEDIATE`
 * was spotted alongside insert/update during review.
 *
 * Runner: bun:sqlite file-mode I/O — must run under `bun test`, not vitest
 * (see store/CLAUDE.md "bun:sqlite is external to vitest"). Uses a REAL
 * temp-dir-backed `SQLiteStore` (not `:memory:` — an in-memory DB has no
 * backing file), unlike `provenance-writes.bun.test.ts`'s cross-store parity
 * suite.
 *
 * ── Fault-injection technique (task-provenance-writes-io-error-s-four-cases) ──
 *
 * This file used to fake the I/O fault by `unlinkSync`-ing the backing file
 * (+ `-wal`/`-shm`) out from under the still-open `Database` handle. That is
 * a POSIX no-op in disguise: unlinking a file a process holds open removes
 * only the DIRECTORY ENTRY — the inode and bun:sqlite's existing fd survive,
 * so whether a subsequent statement actually fails depends on incidental
 * driver/OS state (WAL checkpoint timing, page-cache contents, whether
 * `-shm` was already mapped). Measured: 1 failure in 3 consecutive runs with
 * NO code change — a coin flip, not a fault.
 *
 * Four techniques were weighed for the replacement (all four required by the
 * task, verified rather than assumed per its explicit instruction):
 *
 *   (a) `chmod 000` the db file. REJECTED — empirically verified on macOS
 *       (Darwin 25.1, APFS, non-root owner) that this has NO EFFECT on an
 *       ALREADY-OPEN file descriptor: a `db.run("BEGIN IMMEDIATE")` /
 *       INSERT / COMMIT cycle against a `chmod 000`'d backing file still
 *       succeeds, twice in a row. This matches POSIX semantics — permission
 *       is checked at `open(2)`, never re-checked per read/write syscall —
 *       so the same holds on Linux/ext4; it is not a macOS-specific gap.
 *   (b) `chmod 000` the CONTAINING directory (to block a create/reopen of
 *       `-wal`/`-shm`). REJECTED for the same empirically-verified reason:
 *       the sidecar files are already open before the fault is applied, so
 *       there is no create/reopen left for the directory permission to
 *       block. Also verified with the same probe, same result: no throw.
 *   (d) A read-only connection / immutable filesystem. REJECTED without
 *       implementing: a genuinely read-only *connection* doesn't fit here
 *       (the store must succeed on setup writes before the fault is
 *       injected), and the immutable-flag route is asymmetric across the
 *       two target platforms without elevated privilege — macOS lets an
 *       owning non-root user set `chflags uchg` on their own file, but
 *       Linux's `chattr +i` requires `CAP_LINUX_IMMUTABLE` (root) for a
 *       regular user even on a file they own — so it cannot be "deterministic
 *       on both macOS and Linux" under the same unprivileged test process.
 *   (c) A seam. CHOSEN. `SQLiteStore` does not accept an injected
 *       driver/connection at construction (checked first, per the task's
 *       instruction not to add new production surface unless the check says
 *       otherwise) — but it already exposes the REAL live driver via the
 *       existing, already-production-used `getDatabase()` accessor (see
 *       `sqlite-store.ts`: "Expose the underlying Database for adapters that
 *       need direct SQL access", today's caller is `ApiKeyStore`). No new
 *       production surface is added. `injectBeginImmediateFailure` below
 *       takes that real `Database`, and overrides ONLY its `run` method to
 *       throw synchronously when the SQL text is exactly `"BEGIN IMMEDIATE"`
 *       — the literal statement text every `*WithProvenance` method issues
 *       to open its transaction (verified by grep: `this.db.run(...)` in
 *       `sqlite-store.ts` is used ONLY for `PRAGMA`/`BEGIN IMMEDIATE`/
 *       `COMMIT`/`ROLLBACK` plus two unrelated `INSERT`/`DELETE` statements
 *       that don't start with "BEGIN" — the real doc/version/audit writes go
 *       through `Statement.run` via `db.prepare(...).run(...)`, a DIFFERENT
 *       method this override never touches, confirmed empirically: a
 *       prepared-statement INSERT succeeds unaffected while the override is
 *       active). This is deterministic on BOTH macOS and Linux because it
 *       never touches the filesystem or the OS permission model at all —
 *       the fault is pure JS-level interception of a specific driver call,
 *       verified empirically (3 consecutive throws, 0 unexpected successes)
 *       before being adopted here. It is also REVERSIBLE (`restore()`),
 *       which is what makes the AC2 control-run proof possible: lift the
 *       fault and show the identical call now succeeds on the SAME
 *       connection, ruling out "the fault silently stopped firing" (this
 *       repo's fifth false-oracle face) as the reason a case is green.
 *
 * @spec_ref adhoc task-fix-result-contract-gap-begin-immediate-issued-outside-try
 * @spec_ref adhoc task-provenance-writes-io-error-s-four-cases-inject-i-o-faults
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry, DocRecord, VersionRecord } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { actedStore } from "../../live-invocation.js";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return {
    id: `01HIOERR${padded}`,
    slug: `knowledge-io-error-fixture-${_counter}`,
    type: "knowledge",
    role: "knowledge",
    title: `IO Error Fixture ${_counter}`,
    status: "draft",
    priority: "medium",
    content: "Original content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-25T00:00:00.000Z",
    updated_at: "2026-07-25T00:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ...overrides,
  };
}

function makeVersion(doc: DocRecord, overrides: Partial<VersionRecord> = {}): VersionRecord {
  return {
    doc_id: doc.id,
    version: doc.version,
    content: doc.content,
    extra: doc.extra,
    status: doc.status,
    title: doc.title,
    action: "create",
    created_at: doc.created_at,
    created_by: doc.created_by,
    ...overrides,
  };
}

function makeAudit(doc: DocRecord, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: doc.created_at,
    actor: "system",
    session_id: doc.id,
    action: "create",
    doc_id: doc.id,
    details: { version: doc.version },
    ...overrides,
  };
}

/** Message text of the synthetic fault thrown by {@link injectBeginImmediateFailure}. */
const INJECTED_FAULT_MESSAGE = "Injected fault (test double): simulated SQLITE_IOERR at BEGIN IMMEDIATE";

/**
 * Handle returned by {@link injectBeginImmediateFailure}: `hitCount` proves
 * the fault actually fired (rather than merely that an assertion passed —
 * AC2's anti-false-oracle requirement), `restore()` lifts it so a
 * subsequent call on the SAME connection can prove the identical operation
 * succeeds once the fault is gone (AC2's control-run requirement).
 */
interface BeginImmediateFaultHandle {
  hitCount: number;
  restore(): void;
}

/**
 * Overrides `store`'s REAL underlying `Database.run` (obtained via the
 * already-existing, already-production-used `SQLiteStore.getDatabase()`
 * accessor — no new production surface added) so that every call whose SQL
 * text is exactly `"BEGIN IMMEDIATE"` throws synchronously instead of
 * reaching bun:sqlite's native driver. This is the literal statement every
 * `*WithProvenance` method issues to open its transaction; every other
 * `db.run` call (PRAGMA/COMMIT/ROLLBACK) and every prepared-statement write
 * (`db.prepare(...).run(...)`, a different method entirely — the actual
 * doc/version/audit INSERTs) passes through untouched. See the module
 * header for the full weighing of alternatives and why this one is
 * deterministic on both macOS and Linux (it never touches the filesystem or
 * OS permission model — pure JS-level call interception).
 *
 * The fault is PERSISTENT (fires on every matching call, not just the
 * first) until `restore()` is invoked, mirroring the semantics the old
 * file-deletion technique intended (a standing condition on the
 * connection), which is what the STATE case below needs: a SECOND
 * `BEGIN IMMEDIATE` on the same handle must fail with the SAME injected
 * fault, not a different "cannot start a transaction within a transaction"
 * error that would indicate the first failed BEGIN left the connection's
 * transaction bookkeeping stuck open.
 */
function injectBeginImmediateFailure(store: SQLiteStore): BeginImmediateFaultHandle {
  const db = store.getDatabase();
  const originalRun = db.run.bind(db);
  const handle: BeginImmediateFaultHandle = {
    hitCount: 0,
    restore: () => {
      // reason: cast back to the real (generic) signature — the override
      // below is intentionally typed narrower than `Database.run`'s generic
      // signature, see the cast note at the assignment site.
      db.run = originalRun as typeof db.run;
    },
  };
  const intercepting = (sql: string, ...bindings: unknown[]): unknown => {
    if (sql === "BEGIN IMMEDIATE") {
      handle.hitCount += 1;
      throw new Error(INJECTED_FAULT_MESSAGE);
    }
    // reason: `bindings` here is always empty for this test's own PRAGMA/
    // COMMIT/ROLLBACK/BEGIN-only usage of `db.run`, but production code
    // paths beyond this test's reach (e.g. `insertTraceEvent`) call
    // `db.run` with bind params too — forward them unchanged so this
    // override is faithful to the real method for every non-intercepted
    // call, not merely the ones this file happens to exercise.
    return originalRun(sql, ...(bindings as Parameters<typeof originalRun>[1][]));
  };
  // reason: `Database.run` is declared with a generic `ParamsType extends
  // SQLQueryBindings[]` signature; a concrete override can't structurally
  // match that generic shape, so the assignment is cast. Runtime behavior
  // (verified empirically before adoption: 3/3 deterministic throws, a
  // prepared-statement INSERT unaffected while active, and a real
  // BEGIN IMMEDIATE succeeding again after `restore()`) is what this test
  // file actually relies on, not the static type.
  db.run = intercepting as unknown as typeof db.run;
  return handle;
}

describe("SQLiteStore — insertWithProvenance/updateWithProvenance never throw on a synchronous BEGIN IMMEDIATE I/O error", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: SQLiteStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-io-error-"));
    dbPath = join(tmpDir, "lore.db");
    store = actedStore(new SQLiteStore(dbPath));
  });

  afterEach(() => {
    // reason: `store.close()` calls `Database.close()`, a method this
    // file's fault injection never overrides (only `Database.run` is
    // patched) — so closing succeeds even after a test has left the fault
    // active. The try/catch is kept anyway as defence-in-depth cleanup, not
    // because a failure is expected.
    try {
      store.close();
    } catch {
      // reason: cleanup best-effort — a close() failure here is not itself
      // a test failure.
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── ERROR — the core regression this file guards ───────────────────────

  it("ERROR — insertWithProvenance returns err(STORE_ERROR) instead of throwing when BEGIN IMMEDIATE synchronously throws", async () => {
    const fault = injectBeginImmediateFailure(store);

    const doc = makeDoc();
    let thrown: unknown;
    let result: Awaited<ReturnType<SQLiteStore["insertWithProvenance"]>> | undefined;
    try {
      result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
    // AC2 anti-false-oracle: prove the fault actually fired, not merely that
    // the assertions above happened to pass.
    expect(fault.hitCount).toBeGreaterThanOrEqual(1);
  });

  it("ERROR — updateWithProvenance returns err(STORE_ERROR) instead of throwing when BEGIN IMMEDIATE synchronously throws", async () => {
    const seedDoc = makeDoc({ title: "Pre-Fault Title" });
    const seedResult = await store.insertWithProvenance(seedDoc, makeVersion(seedDoc), makeAudit(seedDoc));
    expect(seedResult.ok).toBe(true);

    const fault = injectBeginImmediateFailure(store);

    const patch: Partial<DocRecord> = { title: "Should Never Apply", version: 2 };
    const version = makeVersion(seedDoc, { version: 2, title: "Should Never Apply", action: "update" });
    const audit = makeAudit(seedDoc, { action: "update", details: { version: 2 } });

    let thrown: unknown;
    let result: Awaited<ReturnType<SQLiteStore["updateWithProvenance"]>> | undefined;
    try {
      result = await store.updateWithProvenance(
        seedDoc.id,
        patch,
        { expected_version: 1 },
        version,
        audit,
      true,
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
    // AC2 anti-false-oracle: prove the fault actually fired.
    expect(fault.hitCount).toBeGreaterThanOrEqual(1);
  });

  it("ERROR — softDeleteWithProvenance returns err(STORE_ERROR) instead of throwing when BEGIN IMMEDIATE synchronously throws", async () => {
    const seedDoc = makeDoc({ title: "Pre-Fault Soft-Delete Target" });
    const seedResult = await store.insertWithProvenance(seedDoc, makeVersion(seedDoc), makeAudit(seedDoc));
    expect(seedResult.ok).toBe(true);

    const fault = injectBeginImmediateFailure(store);

    const version = makeVersion(seedDoc, {
      version: 0,
      content: "",
      extra: {},
      status: "archived",
      title: "",
      action: "delete",
    });
    const audit = makeAudit(seedDoc, { action: "delete", details: { version: 0 } });

    let thrown: unknown;
    let result: Awaited<ReturnType<SQLiteStore["softDeleteWithProvenance"]>> | undefined;
    try {
      result = await store.softDeleteWithProvenance(seedDoc.id, version, audit);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
    // AC2 anti-false-oracle: prove the fault actually fired.
    expect(fault.hitCount).toBeGreaterThanOrEqual(1);
  });

  // ── STATE — no dangling open transaction on the still-alive connection ──

  it("STATE — after the I/O error, a fresh BEGIN IMMEDIATE on the same handle does not fail with 'cannot start a transaction within a transaction'", async () => {
    // reason: the fix's split try/catch deliberately does NOT attempt a
    // ROLLBACK when BEGIN IMMEDIATE itself is what threw (there is no open
    // transaction to roll back — bun:sqlite would throw ROLLBACK's own
    // "no transaction is active" error if it tried). This proves that
    // decision doesn't leave the connection's `inTransaction` flag stuck
    // true: the fault stays PERSISTENT across both calls (see
    // `injectBeginImmediateFailure`'s header — it does not auto-restore), so
    // issuing the SAME call again must fail with the ORIGINAL injected-fault
    // class, not a stacked transaction-state error, which would indicate the
    // failed BEGIN silently left the driver's internal state open.
    const fault = injectBeginImmediateFailure(store);

    const doc = makeDoc();
    const first = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(first.ok).toBe(false);

    const second = await store.insertWithProvenance(
      makeDoc(),
      makeVersion(makeDoc()),
      makeAudit(makeDoc()),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    // A stacked "cannot start a transaction within a transaction" error
    // would be a DIFFERENT wrapStoreError message than the repeated
    // injected-fault error — both are STORE_ERROR-coded, so assert on the
    // message content to distinguish a clean repeat failure from a wedged
    // connection.
    expect(second.error.code).toBe("STORE_ERROR");
    if (second.error.code === "STORE_ERROR") {
      expect(second.error.message.toLowerCase()).not.toContain("within a transaction");
    }
    // AC2 anti-false-oracle: the fault must have fired for BOTH calls — a
    // hitCount of 1 here would mean the second call somehow never reached
    // `db.run("BEGIN IMMEDIATE")` at all (a different silent-degradation
    // shape than a stuck transaction, but still not what this case claims
    // to prove).
    expect(fault.hitCount).toBe(2);
  });

  // ── CONTROL — the fault itself, not something incidental, causes the failure ──

  it("CONTROL — insertWithProvenance succeeds once the injected BEGIN IMMEDIATE fault is lifted, proving the fault (not something else) caused the ERROR cases above to fail", async () => {
    const fault = injectBeginImmediateFailure(store);

    const faultedDoc = makeDoc();
    const faulted = await store.insertWithProvenance(faultedDoc, makeVersion(faultedDoc), makeAudit(faultedDoc));
    expect(faulted.ok).toBe(false);
    if (!faulted.ok) {
      expect(faulted.error.code).toBe("STORE_ERROR");
      if (faulted.error.code === "STORE_ERROR") {
        expect(faulted.error.message).toBe(INJECTED_FAULT_MESSAGE);
      }
    }
    expect(fault.hitCount).toBeGreaterThanOrEqual(1);

    // Lift the fault on the SAME connection/store instance.
    fault.restore();

    const recoveredDoc = makeDoc();
    const recovered = await store.insertWithProvenance(recoveredDoc, makeVersion(recoveredDoc), makeAudit(recoveredDoc));
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.value.title).toBe(recoveredDoc.title);
    }

    // Confirm the doc from the failed attempt was never persisted (the
    // failed BEGIN IMMEDIATE means no transaction ever opened, so there is
    // nothing to roll back and nothing to have committed).
    const found = await store.find(faultedDoc.id);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value).toBeNull();
    }
  });

  // ── REGRESSION — the happy path is unaffected by moving BEGIN inside a guard ──

  it("REGRESSION — insertWithProvenance still succeeds and is fully observable when no fault is injected", async () => {
    const doc = makeDoc({ title: "Still Works" });
    const result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Still Works");

    const found = await store.find(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.title).toBe("Still Works");
  });

  it("REGRESSION — softDeleteWithProvenance still succeeds when no fault is injected", async () => {
    const doc = makeDoc({ title: "Still Deletable" });
    const seedResult = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(seedResult.ok).toBe(true);

    const version = makeVersion(doc, {
      version: 0,
      content: "",
      extra: {},
      status: "archived",
      title: "",
      action: "delete",
    });
    const audit = makeAudit(doc, { action: "delete", details: { version: 0 } });
    const result = await store.softDeleteWithProvenance(doc.id, version, audit);
    expect(result.ok).toBe(true);

    const found = await store.find(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.deleted_at).not.toBeNull();
  });
});
