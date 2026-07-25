// SPIKE-CONCLUSION: throw — deleting a mounted corpus's `lore.db` (+ `-wal`/`-shm`)
// mid-session, while its `bun:sqlite` `Database` handle stays open, makes the NEXT
// write against that corpus REJECT near-instantly (observed ~0-1ms, always << the
// 5000ms ceiling) with a real thrown `SQLiteError` ("disk I/O error",
// `SQLITE_IOERR_VNODE`) — never a hang. A concurrent operation against an intact
// corpus B is unaffected and resolves normally in the SAME window. Watchdog
// verdict for T8: NOT REQUIRED for this failure mode — Promise.race around store
// dispatch would be pure defense-in-depth here, not a fix for an observed hang.

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
 * dedicated ceiling assertion fails the test. This mechanism, not the assertion
 * on WHICH branch occurred, is what makes the AC's "never hangs" guarantee
 * regression-proof: a future SQLiteStore change that turns this failure mode
 * into a hang trips this file even if nobody remembers today's throw finding.
 *
 * Root-cause note (not fixed here — out of this task's anchors, filed for a
 * follow-up): the reject-not-hang behavior traces to
 * `SQLiteStore.insertWithProvenance` issuing `this.db.run("BEGIN IMMEDIATE")`
 * OUTSIDE its own `try { ... } catch (e) { return wrapStoreError(e); }` block
 * (`packages/lore/src/store/sqlite-store.ts`) — so a synchronous `bun:sqlite`
 * throw from that one call escapes as a REAL exception instead of the
 * `Result<T, LoreError>` the rest of the codebase's "no exceptions cross
 * service boundaries" convention promises. It happens to be lucky here (fast
 * throw beats a hang), but it is still a Result-contract gap worth closing —
 * this spike's job is to pin the liveness behavior, not patch that gap.
 *
 * Six-dimension framing: HAPPY (the AC's core throw-vs-hang + concurrent-B
 * scenario) and STATE (repeat A-operation after the first failure — proves the
 * fast-reject is a stable characteristic of the broken connection, not a
 * one-off artifact of the first failing call) are the only dimensions that
 * make sense for an empirical liveness pin — there is no NEGATIVE/BOUNDARY/
 * ERROR/REGRESSION variant of "does an already-broken store hang".
 *
 * @spec_ref spec-078-dashboard-multi-project-mount-registry-machine-scope AC-078-3
 */

import { afterEach, describe, expect, it } from "bun:test";
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
    // toolchain): corpus A's write REJECTS, and does so fast — not merely
    // "under the 5000ms ceiling" but near-instantly, ruling out a slow-path
    // near-miss.
    expect(resultA.settled).toBe("rejected");
    expect(resultA.ms).toBeLessThan(1000);
    if (resultA.settled === "rejected") {
      expect(String(resultA.error)).toContain("SQLiteError");
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
  it("a second consecutive A-operation after the first failure also settles under the ceiling (not a first-call-only artifact)", async () => {
    const corpusA = makeScratchCorpus("liveness-a-repeat-");
    const seedA = await corpusA.app.corpusService.create({ type: "prd", title: "Corpus A Root", content: "root" });
    expect(seedA.ok).toBe(true);

    unlinkCorpusDb(corpusA.dbPath);

    const first = await withCeiling(
      corpusA.app.corpusService.create({ type: "prd", title: "First after unlink", content: "1" }),
    );
    expect(first.settled).not.toBe("TIMEOUT");
    expect(first.settled).toBe("rejected");

    const second = await withCeiling(
      corpusA.app.corpusService.create({ type: "prd", title: "Second after unlink", content: "2" }),
    );
    expect(second.settled).not.toBe("TIMEOUT");
    expect(second.settled).toBe("rejected");
  });
});
