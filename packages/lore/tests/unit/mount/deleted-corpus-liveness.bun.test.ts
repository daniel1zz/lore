// SPIKE-CONCLUSION (revised 2026-07-25, task-stabilize-deleted-corpus-liveness-2):
// settle-fast, never hang — deleting a mounted corpus's `lore.db` (+ `-wal`/`-shm`)
// mid-session, while its `bun:sqlite` `Database` handle stays open, makes the NEXT
// write against that corpus SETTLE near-instantly (observed well under the 5000ms
// ceiling in every recorded run) — but WHICH way it settles is a genuine OS/SQLite
// race, not a JS-event-loop timing artifact. THREE legitimate settlements are
// pinned here, not two:
//   1. REJECTED — a thrown `SQLiteError` ("disk I/O error", `SQLITE_IOERR_VNODE`)
//      escaping past `SQLiteStore.insertWithProvenance`'s `BEGIN IMMEDIATE` call
//      (see the root-cause note below on that call sitting outside its own
//      try/catch).
//   2. RESOLVED, self-heal (`ok: true`) — POSIX unlink-while-open keeps the main
//      db file's inode alive via the already-open fd, so if `bun:sqlite`'s WAL
//      layer needs to reopen `-wal`/`-shm` before this write (e.g. an
//      auto-checkpoint fired in the gap since the seed write), `open(O_CREAT)` on
//      the now-directory-entry-free path trivially succeeds, a fresh WAL is
//      created, and the write lands normally.
//   3. RESOLVED, guarded-IOERR (`ok: false`, `error.code === "STORE_ERROR"`) —
//      added 2026-07-25 once `SQLiteStore.insertWithProvenance` /
//      `updateWithProvenance` / `softDeleteWithProvenance`
//      (`packages/lore/src/store/sqlite-store.ts`, commits 009ee41/15a2e52)
//      wrapped their `BEGIN IMMEDIATE` call in its own try/catch returning
//      `wrapStoreError(e)` — a SQLITE_IOERR that used to escape as branch 1's
//      thrown exception now resolves as a well-formed `Result` err instead. That
//      store fix is the ORIGIN of this third branch: it converts a former reject
//      into a resolve, it does not introduce a new failure mode.
// Under concurrent full-suite load this file has recorded all three branches
// (SPEC-078 T7/T8 evidence for branch 2; a full-suite run after the store fix
// landed for branch 3, which an earlier version of this test's resolved-branch
// assertion did not yet allow for — see the two `else`-branch comments below); in
// EVERY recorded run — loaded or not — the operation has settled well under the
// ceiling and never once hit TIMEOUT. Watchdog verdict for T8: NOT REQUIRED for
// this failure mode in ANY branch — Promise.race around store dispatch would be
// pure defense-in-depth here, not a fix for an observed hang. A concurrent
// operation against an intact corpus B is unaffected and resolves normally in the
// SAME window regardless of which branch A takes.

/**
 * SPEC-078 D8 — deleted-corpus liveness spike (throw-vs-hang empirical pin).
 *
 * Why this exists: SPEC-078 introduces a multi-project mount registry where one
 * corpus's on-disk state can go missing (deleted, moved, unmounted drive) while
 * OTHER mounted corpora keep serving traffic in the SAME process. The Ops-raised
 * H-risk was "a broken corpus's store call hangs and starves the event loop for
 * every other mounted project." This test empirically settles throw-vs-hang
 * BEFORE T8 decides whether store dispatch needs a watchdog/timeout wrapper.
 *
 * Method: two throwaway `mkdtemp` corpora (⛔ never the repo's own `.lore/` —
 * see root CLAUDE.md's 2026-07-07 pollution-incident convention), each mounted
 * via the REAL production composition root `createApp` (bun:sqlite reachability
 * confines this file to `bun test`, mirrors `flows/init-corpus.bun.test.ts` and
 * `tests/http/phase-status.bun.test.ts`'s createApp-over-InMemoryStore rationale).
 * Corpus A's db file (+ WAL sidecars — SQLiteStore runs `PRAGMA journal_mode =
 * WAL`, so the sidecars are load-bearing, not incidental) is unlinked mid-session.
 * A subsequent A-operation is raced against a 5000ms ceiling timer via
 * `withCeiling` — if the timer ever wins, `settled === "TIMEOUT"` and the
 * dedicated ceiling assertion fails the test. This mechanism is what makes the
 * AC's "never hangs" guarantee regression-proof: a future SQLiteStore change
 * that turns this failure mode into a hang trips this file regardless of which
 * settle branch (resolve/reject) is in play. The assertions deliberately do
 * NOT pin WHICH branch occurs (see file-header SPIKE-CONCLUSION for why that
 * is a genuine OS/SQLite race, not noise this test should paper over) — only
 * that it settles, and settles fast.
 *
 * Root-cause note (not fixed here — out of this task's anchors, filed for a
 * follow-up): the reject branch's fast-throw traces to
 * `SQLiteStore.insertWithProvenance` issuing `this.db.run("BEGIN IMMEDIATE")`
 * OUTSIDE its own `try { ... } catch (e) { return wrapStoreError(e); }` block
 * (`packages/lore/src/store/sqlite-store.ts`) — so a synchronous `bun:sqlite`
 * throw from that one call escapes as a REAL exception instead of the
 * `Result<T, LoreError>` the rest of the codebase's "no exceptions cross
 * service boundaries" convention promises. It happens to be lucky here (fast
 * throw beats a hang), but it is still a Result-contract gap worth closing —
 * this spike's job is to pin the liveness behavior, not patch that gap.
 *
 * Six-dimension framing: HAPPY (the AC's core settle-fast-vs-hang + concurrent-B
 * scenario) and STATE (repeat A-operation after the first — proves fast
 * settlement is a stable characteristic of the broken connection across
 * repeated calls, not a one-off artifact of the first call) are the only
 * dimensions that make sense for an empirical liveness pin — there is no
 * NEGATIVE/BOUNDARY/ERROR/REGRESSION variant of "does an already-broken store
 * hang".
 *
 * @spec_ref spec-078-dashboard-multi-project-mount-registry-machine-scope AC-078-3
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createApp } from "../../../src/app.js";

const RACE_CEILING_MS = 5000;

const scratchDirs: string[] = [];

function makeScratchCorpus(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  mkdirSync(join(dir, ".lore"), { recursive: true });
  const dbPath = join(dir, ".lore", "lore.db");
  const app = createApp(dbPath);
  return { dir, dbPath, app };
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // reason: best-effort scratch cleanup — a failure here must never fail
      // the test that already ran (mirrors init-corpus.bun.test.ts's afterEach).
    }
  }
});

type Settled<T> =
  | { settled: "resolved"; ms: number; value: T }
  | { settled: "rejected"; ms: number; error: unknown }
  | { settled: "TIMEOUT"; ms: number };

/**
 * Races `promise` against a `RACE_CEILING_MS` timer. THIS is the mechanism the
 * AC's "never hangs past the ceiling" guarantee rests on: if `promise` never
 * settles, the timer wins, `settled` comes back `"TIMEOUT"`, and the caller's
 * dedicated assertion (`expect(result.settled).not.toBe("TIMEOUT")`) fails the
 * test — a hang can never read as a silent pass in this file.
 */
function withCeiling<T>(promise: Promise<T>): Promise<Settled<T>> {
  const start = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ settled: "TIMEOUT", ms: Date.now() - start });
    }, RACE_CEILING_MS);
    // reason: an already-settled race must not hold the test process open on
    // this timer for the remainder of RACE_CEILING_MS.
    (timer as unknown as { unref?: () => void }).unref?.();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ settled: "resolved", ms: Date.now() - start, value });
      },
      (error: unknown) => {
        clearTimeout(timer);
        resolve({ settled: "rejected", ms: Date.now() - start, error });
      },
    );
  });
}

/** Unlinks a corpus's db file AND its WAL sidecars (journal_mode=WAL means the
 * sidecars are part of "the corpus is gone", not incidental cleanup). */
function unlinkCorpusDb(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = dbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
}

/**
 * Asserts a RESOLVED (never rejected/TIMEOUT — callers gate on that separately)
 * settle outcome is one of the two legitimate resolve branches from the
 * file-header SPIKE-CONCLUSION:
 *   - self-heal — the write actually landed (`ok: true`); or
 *   - guarded-IOERR — `SqliteStore`'s `BEGIN IMMEDIATE` try/catch
 *     (`packages/lore/src/store/sqlite-store.ts`, commits 009ee41/15a2e52)
 *     converted a SQLITE_IOERR that used to escape as a thrown exception into a
 *     resolved `err({ code: "STORE_ERROR" })` instead.
 * Anything else on resolve — including `ok: false` with a DIFFERENT error
 * code — still fails this assertion; it deliberately does not widen to "any
 * resolve is fine".
 */
function expectLegitimateResolve(value: unknown): void {
  const v = value as { ok: boolean; error?: { code?: string } };
  const selfHeal = v.ok === true;
  const guardedIoerr = v.ok === false && v.error?.code === "STORE_ERROR";
  expect(selfHeal || guardedIoerr).toBe(true);
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("deleted-corpus liveness spike — HAPPY", () => {
  it("A settles (never hangs) within the 5000ms ceiling after its db is unlinked mid-session, while B succeeds concurrently", async () => {
    const corpusA = makeScratchCorpus("liveness-a-");
    const corpusB = makeScratchCorpus("liveness-b-");

    const seedA = await corpusA.app.corpusService.create({ type: "prd", title: "Corpus A Root", content: "root" });
    const seedB = await corpusB.app.corpusService.create({ type: "prd", title: "Corpus B Root", content: "root" });
    expect(seedA.ok).toBe(true);
    expect(seedB.ok).toBe(true);

    unlinkCorpusDb(corpusA.dbPath);
    expect(existsSync(corpusA.dbPath)).toBe(false);
    expect(existsSync(corpusB.dbPath)).toBe(true);

    const [resultA, resultB] = await Promise.all([
      withCeiling(corpusA.app.corpusService.create({ type: "prd", title: "A op after unlink", content: "after" })),
      withCeiling(corpusB.app.corpusService.create({ type: "prd", title: "B op concurrent", content: "concurrent" })),
    ]);

    // ⛔ THE ceiling assertion this spike exists for. If A's operation ever
    // hangs past RACE_CEILING_MS, resultA.settled is "TIMEOUT" and THIS line
    // fails the test — never a silent pass.
    expect(resultA.settled).not.toBe("TIMEOUT");

    // Empirically pinned (2026-07-25, macOS + bun:sqlite WAL mode, this repo's
    // toolchain): corpus A's write always SETTLES fast — well under half the
    // ceiling, ruling out a slow-path near-miss — but WHICH way it settles is a
    // genuine OS/SQLite race (see file-header SPIKE-CONCLUSION), not something
    // this test should force into one branch. An earlier version of this
    // assertion required `settled === "rejected"` unconditionally and recorded
    // two failures under concurrent full-suite load where the resolve branch
    // fired instead (SPEC-078 T7/T8 evidence) — both were fast, non-hanging
    // settlements, i.e. exactly what this spike exists to confirm.
    expect(["resolved", "rejected"]).toContain(resultA.settled);
    expect(resultA.ms).toBeLessThan(RACE_CEILING_MS / 2);
    if (resultA.settled === "rejected") {
      expect(String(resultA.error)).toContain("SQLiteError");
    } else if (resultA.settled === "resolved") {
      // Two legitimate resolve outcomes (see SPIKE-CONCLUSION's branches 2/3):
      // self-heal (bun:sqlite reopened a fresh -wal at the now-directory-
      // entry-free path and the write actually landed, ok: true) OR
      // guarded-IOERR (the sqlite-store.ts BEGIN IMMEDIATE try/catch fix,
      // commits 009ee41/15a2e52, turned a would-be thrown SQLITE_IOERR into a
      // resolved err({ code: "STORE_ERROR" })) — both are legitimate "did not
      // hang" outcomes, not corruption. A resolve with any OTHER error code
      // still fails expectLegitimateResolve.
      expectLegitimateResolve(resultA.value);
    }

    // Corpus B, mounted on an intact db file, must succeed in the SAME window
    // — corpus A's failure must never cross-contaminate corpus B (the core
    // "other mounted projects keep serving" requirement behind D8).
    expect(resultB.settled).toBe("resolved");
    if (resultB.settled === "resolved") {
      expect((resultB.value as { ok: boolean }).ok).toBe(true);
    }
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("deleted-corpus liveness spike — STATE", () => {
  it("a second consecutive A-operation after the first also settles fast, never hangs (not a first-call-only artifact)", async () => {
    const corpusA = makeScratchCorpus("liveness-a-repeat-");
    const seedA = await corpusA.app.corpusService.create({ type: "prd", title: "Corpus A Root", content: "root" });
    expect(seedA.ok).toBe(true);

    unlinkCorpusDb(corpusA.dbPath);

    // Per the file-header SPIKE-CONCLUSION, WHICH branch (resolve/reject) each
    // call takes is a genuine OS/SQLite race — not pinned here, deliberately.
    // What this STATE variant exists to prove is that fast settlement (never a
    // hang) is a stable characteristic across repeated calls against the same
    // broken connection, not a one-off artifact of the first call.
    const first = await withCeiling(
      corpusA.app.corpusService.create({ type: "prd", title: "First after unlink", content: "1" }),
    );
    expect(first.settled).not.toBe("TIMEOUT");
    expect(first.ms).toBeLessThan(RACE_CEILING_MS / 2);
    if (first.settled === "rejected") {
      expect(String(first.error)).toContain("SQLiteError");
    } else if (first.settled === "resolved") {
      // Mirrors the HAPPY test's resolved-branch check (SPIKE-CONCLUSION
      // branches 2/3: self-heal ok:true, or guarded-IOERR err STORE_ERROR
      // from the sqlite-store.ts BEGIN IMMEDIATE try/catch fix, commits
      // 009ee41/15a2e52) — any OTHER error code still fails this assertion.
      expectLegitimateResolve(first.value);
    }

    const second = await withCeiling(
      corpusA.app.corpusService.create({ type: "prd", title: "Second after unlink", content: "2" }),
    );
    expect(second.settled).not.toBe("TIMEOUT");
    expect(second.ms).toBeLessThan(RACE_CEILING_MS / 2);
    if (second.settled === "rejected") {
      expect(String(second.error)).toContain("SQLiteError");
    } else if (second.settled === "resolved") {
      // Same legitimate-resolve check as `first` above — repeated calls
      // against the same broken connection can independently land on either
      // branch; this STATE variant does not pin them to match each other.
      expectLegitimateResolve(second.value);
    }
  });
});
