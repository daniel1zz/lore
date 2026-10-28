// @spawns packages/lore/tests/unit/store/.verbatim-slug-worker.*.mjs -- the test writes a pid-named worker script next to itself
/** @spec_ref AC-GR-4 */
/**
 * Tests for D2 (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam):
 * `CorpusService.create` uses a caller-supplied `slug` VERBATIM — no
 * `slugifyWithCollision` suffixing — so the store's UNIQUE index on
 * `docs.slug` becomes the SOLE arbiter of identity. A collision must surface
 * as the typed `DUPLICATE_SLUG` error, never a silently aliased "-2" slug and
 * never a generic `STORE_ERROR`.
 *
 * Why this needs SEPARATE PROCESSES, not two sequential in-process calls:
 * `bun:sqlite` writes are synchronous, so two `await corpusService.create(...)`
 * calls made back-to-back in the SAME process never actually contend — the
 * second call's `BEGIN IMMEDIATE` cannot even be issued until the first
 * call's synchronous write has already returned control to the event loop.
 * A "concurrency" test built that way would pass on the UNIQUE constraint
 * without ever exercising a genuine race between two writers. This file
 * spawns TWO real child processes (`WORKER_SCRIPT`, written to a file
 * ALONGSIDE this test — see `workerScriptPath` below for why it cannot live
 * in an OS tmpdir), each opening its OWN `SQLiteStore` connection to the SAME
 * db file, each calling the REAL `CorpusService.create` with the SAME
 * verbatim slug, released together off a shared barrier file only once BOTH
 * have signalled they are open and waiting — repeated for 20 iterations with
 * a fresh slug per iteration.
 *
 * The outcome is deterministic, not merely probable: `insertWithProvenance`
 * (sqlite-store.ts) opens each write with `BEGIN IMMEDIATE`, which serializes
 * the two connections at the SQLite file-lock level — the second (blocked)
 * writer waits out `PRAGMA busy_timeout` (SPEC-078 D9) and then runs its own
 * INSERT, which is the one that trips the UNIQUE constraint. So every single
 * iteration produces exactly one winner and one `DUPLICATE_SLUG` loser; there
 * is no "maybe neither raced" outcome to tolerate.
 *
 * Six-dimension coverage:
 *   STATE:      20 iterations of the real cross-process race — exactly 1 doc
 *               ends up carrying each iteration's slug, exactly 1 process
 *               exits ok, and the loser's error is EXACTLY DUPLICATE_SLUG.
 *   BOUNDARY:   the winner's persisted slug is byte-identical to the
 *               requested verbatim slug — no suffix, no transliteration.
 *   NEGATIVE:   the loser's error code is asserted to differ from the
 *               generic STORE_ERROR the falsifier would otherwise produce.
 *   REGRESSION: `create()` with NO slug still generates a collision-suffixed
 *               "-2" slug on a genuine title collision — proves the verbatim
 *               path left the pre-existing generated-slug behavior untouched.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
import { actedStore } from "../../live-invocation.js";

/**
 * A standalone child-process worker. It MUST be written to a file inside
 * this repo's own tree (never an OS tmpdir) — its `../../../src/...` imports
 * are production source using the bare `@lore/core` package specifier
 * internally, and Bun/Node module resolution for a bare specifier walks UP
 * from the IMPORTING FILE's own path looking for `node_modules`. A script
 * placed under `/tmp` has no ancestor `node_modules` to find and fails to
 * resolve `@lore/core` entirely. Writing it next to this test file (which
 * lives at the correct depth for the SAME relative imports this suite's own
 * `SQLiteStore`/`CorpusService` imports above already use) keeps resolution
 * inside this worktree's own `node_modules`, never escaping to a sibling
 * checkout (measured directly during this task: with no local
 * `node_modules`, both `tsc` and `bun`'s own resolver walked past this
 * worktree's root and silently resolved `@lore/core` to a DIFFERENT git
 * worktree's copy of the package — `bun install` inside this worktree is
 * what fixes it).
 */
const WORKER_SCRIPT = `
import { existsSync, writeFileSync } from "node:fs";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { declareWriteActorForTests } from "../../../src/store/write-context-store.js";

const [, , dbPath, readyPath, barrierPath, slug, resultPath, parentId] = process.argv;

async function waitFor(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      throw new Error(\`timed out waiting for \${path}\`);
    }
    await Bun.sleep(1);
  }
}

const store = declareWriteActorForTests(new SQLiteStore(dbPath), "slug-race-worker");
const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

// Signal "open and about to wait" BEFORE polling the barrier, so the parent
// can confirm both workers are truly poised before releasing either.
writeFileSync(readyPath, "ready");
await waitFor(barrierPath, 5000);

const result = await corpusService.create({
  parent_id: parentId,
  type: "knowledge",
  title: \`verbatim slug race probe \${slug}\`,
  extra: { sub_type: "reference" },
  slug,
});

writeFileSync(resultPath, JSON.stringify(result));
store.close();
process.exit(result.ok ? 0 : 1);
`;

/** Polls for \`path\` to appear, or throws — mirrors busy-timeout.bun.test.ts's identical helper. */
async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      throw new Error(`file never appeared within ${timeoutMs}ms: ${path}`);
    }
    await Bun.sleep(2);
  }
}

type CreateResultJson =
  | { ok: true; value: { slug: string; [key: string]: unknown } }
  | { ok: false; error: { code: string; [key: string]: unknown } };

describe("CorpusService.create verbatim slug is the sole identity arbiter (D2, AC-GR-4)", () => {
  let tempDir: string;
  let dbPath: string;
  let workerScriptPath: string;
  // reason: the worker processes create knowledge records, which need a parent; the id is made once per corpus here.
  let parentId: string;

  beforeAll(() => {
    // Written next to this test file, not an OS tmpdir — see WORKER_SCRIPT's
    // own doc comment above for why that placement is load-bearing.
    workerScriptPath = join(fileURLToPath(new URL(".", import.meta.url)), `.verbatim-slug-worker.${process.pid}.mjs`);
    writeFileSync(workerScriptPath, WORKER_SCRIPT);
  });

  afterAll(() => {
    rmSync(workerScriptPath, { force: true });
  });

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-verbatim-slug-"));
    dbPath = join(tempDir, "corpus.db");
    // Pre-migrate the schema via a real SQLiteStore BEFORE any child process
    // ever opens this db file, so the race under test is a SLUG-UNIQUENESS
    // race between two writers — never a first-ever-migration race between
    // the two child connections (an orthogonal concern this AC does not own).
    const setup = actedStore(new SQLiteStore(dbPath));
    parentId = await ensureRequirementsDocId(
      new CorpusService(setup, new RecordLockService(setup, new GateEnforcer(undefined))),
    );
    setup.close();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it(
    "STATE: 20 iterations of a real cross-process race converge on exactly 1 doc + 1 DUPLICATE_SLUG loser, never a -2 alias and never a generic STORE_ERROR",
    async () => {
      const ITERATIONS = 20;

      for (let i = 0; i < ITERATIONS; i++) {
        const slug = `test-verbatim-race-${i}`;
        const readyA = join(tempDir, `ready-a-${i}`);
        const readyB = join(tempDir, `ready-b-${i}`);
        const barrier = join(tempDir, `barrier-${i}`);
        const resultAPath = join(tempDir, `result-a-${i}.json`);
        const resultBPath = join(tempDir, `result-b-${i}.json`);

        const procA = Bun.spawn(
          ["bun", workerScriptPath, dbPath, readyA, barrier, slug, resultAPath, parentId],
          { stdout: "pipe", stderr: "pipe" },
        );
        const procB = Bun.spawn(
          ["bun", workerScriptPath, dbPath, readyB, barrier, slug, resultBPath, parentId],
          { stdout: "pipe", stderr: "pipe" },
        );

        // Both workers must be open-and-waiting BEFORE the barrier drops —
        // this is what makes it a genuine race rather than a head start.
        await Promise.all([waitForFile(readyA, 5000), waitForFile(readyB, 5000)]);
        writeFileSync(barrier, "go");

        const [exitA, exitB] = await Promise.all([procA.exited, procB.exited]);

        if (!existsSync(resultAPath) || !existsSync(resultBPath)) {
          const [stderrA, stderrB] = await Promise.all([
            new Response(procA.stderr).text(),
            new Response(procB.stderr).text(),
          ]);
          throw new Error(
            `iteration ${i}: a worker exited without writing its result file. ` +
              `exitA=${exitA} exitB=${exitB} stderrA=${stderrA} stderrB=${stderrB}`,
          );
        }

        const resultA = JSON.parse(readFileSync(resultAPath, "utf-8")) as CreateResultJson;
        const resultB = JSON.parse(readFileSync(resultBPath, "utf-8")) as CreateResultJson;

        // EXACTLY 1 process exited ok.
        const exitCodes = [exitA, exitB];
        expect(exitCodes.filter((code) => code === 0)).toHaveLength(1);

        const results = [resultA, resultB];
        const winners = results.filter((r): r is Extract<CreateResultJson, { ok: true }> => r.ok === true);
        const losers = results.filter((r): r is Extract<CreateResultJson, { ok: false }> => r.ok === false);
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);

        // BOUNDARY: the winner's persisted slug is byte-identical to the
        // requested verbatim slug — no "-2" suffix, no transliteration.
        expect(winners[0]?.value.slug).toBe(slug);

        // The loser's error is EXACTLY DUPLICATE_SLUG — never a generic
        // STORE_ERROR (NEGATIVE) and never absent (the falsifier this AC
        // pins: removing the verbatim path lets slugifyWithCollision run,
        // which would make BOTH processes succeed with a "-2" aliased slug
        // instead of one of them failing here).
        expect(losers[0]?.error.code).toBe("DUPLICATE_SLUG");
        expect(losers[0]?.error.code).not.toBe("STORE_ERROR");

        // The store's UNIQUE index is the sole arbiter: exactly 1 row
        // carries this slug. A raw COUNT query (not `findBySlug`, whose
        // `DocRecord | null` return type is capped at 1 by construction and
        // so cannot itself catch a constraint that silently failed to
        // apply) is the actual falsifiable check.
        const verifyStore = actedStore(new SQLiteStore(dbPath));
        const row = verifyStore
          .getDatabase()
          .query("SELECT COUNT(*) as n FROM docs WHERE slug = ?")
          .get(slug) as { n: number };
        expect(row.n).toBe(1);
        verifyStore.close();
      }
    },
    60_000,
  );

  it("REGRESSION: create() with NO slug still generates a collision-suffixed '-2' slug on a genuine title collision — the verbatim path left this behavior byte-identical", async () => {
    const store = actedStore(new SQLiteStore(dbPath));
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

    const title = "Verbatim Slug Regression Probe";

    const first = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "knowledge",
      title,
      extra: { sub_type: "reference" },
    });
    if (!first.ok) throw new Error(`first create failed: ${JSON.stringify(first.error)}`);
    expect(first.value.slug).toBe("knowledge-verbatim-slug-regression-probe");

    // Same title, still no slug: today's generated-slug behavior must alias
    // with "-2" exactly as it did before this task's change existed.
    const second = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "knowledge",
      title,
      extra: { sub_type: "reference" },
    });
    if (!second.ok) throw new Error(`second create failed: ${JSON.stringify(second.error)}`);
    expect(second.value.slug).toBe("knowledge-verbatim-slug-regression-probe-2");

    store.close();
  });
});
