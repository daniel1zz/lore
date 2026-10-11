/**
 * Tests for `scripts/export-spec-mirror.ts` + `scripts/export-spec-mirror-core.ts` —
 * `spec-falsifiability-reachability-a-feedable-checkpoint-an` D6, AC-FR-6/AC-FR-7/AC-FR-10 (G5).
 *
 * Two halves, deliberately split by IO shape (mirrors `scripts/tests/check-ac-ref-integrity.test.ts`):
 *
 *   1. Pure algorithm suites (`computeMirrorParity`, `scriptChainReachesTarget`, plus the fs-only
 *      helpers `loadMirrorMappings`/`countMdFilesFlat`) import directly from
 *      `../export-spec-mirror-core.js` — that module has NO `bun:sqlite` dependency anywhere in
 *      its import graph (see its own header), unlike the sibling `export-spec-mirror.ts` IO shell
 *      (imports `createApp`, which does).
 *   2. The end-to-end suites read THIS repo's OWN live corpus (via the real `lore` CLI) and THIS
 *      repo's OWN `docs/requirements/` — never a seeded `lore init` fixture corpus, which AC-FR-10
 *      forbids in so many words ("asserted against THIS repo's PRODUCTION corpus (never a seeded
 *      fixture)") and AC-FR-6 likewise ("Asserted against the LIVE corpus count, never a literal
 *      typed into the test").
 *
 *      ⛔ AC-OX-1 (`spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check`): every
 *      subprocess call into `export-spec-mirror.ts` below passes `--check` — the READ-ONLY
 *      drift-report path — and NEVER the bare, write-mode invocation, and never `lore export-docs
 *      --force`, as a "re-establish a clean baseline" step. A prior revision of this file called
 *      the write-mode exporter that way; it made the oracle unfalsifiable (it silently repaired
 *      real drift before any assertion could see it) and left the live corpus mirror REWRITTEN on
 *      disk mid-suite. A check that repairs what it detects cannot fail.
 *
 * ## The three defects this revision fixes, and the shape they share
 *
 * All three were one shape: **a constant sensitive to corpus size, written once and never
 * re-derived.**
 *
 * ⛔ Prior art — READ THESE INSTEAD OF RE-DERIVING ANY OF IT. All three defects were already
 * diagnosed on 2026-08-24, before this revision:
 * `knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in` (approved) holds the ENOBUFS
 * half as its "Failure 1" — same A/B probe, same `result.status ?? 1` diagnosis, which it names
 * "the repo's own banned pattern" — and the timeout half as its "Failures 2 and 3", with the last
 * green runs measured at 28298ms and 27931ms;
 * `knowledge-the-mirror-content-parity-oracle-is-structurally` (approved) holds the
 * exclusive-corpus half. ⛔ Read the CHILD before relying on the parent:
 * `knowledge-two-attributions-in-the-corpus-growth-threshold` (approved) CORRECTS two of the
 * parent's attributions and is authoritative where they disagree. Measurements live in those three
 * docs; this header cites them and does not restate them.
 *
 * **D1 — stale timeout budgets over redundant work.** This file used to make 13
 * `runMirrorScript(["--check"])` subprocess calls, NINE of them per-case "verify a clean baseline
 * first" preconditions — the same full-corpus pass repeated once per case. Measured cost of one
 * `--check` pass on this corpus (2026-08-25): **13.8s warm, 27.9s cold** (a fresh worktree always
 * pays cold; measured 12.3–14.5s per pass warm in this worktree). A case invoking three passes
 * costs ~41s warm against the `30000` budget it declared, so it timed out. This revision makes
 * **5** such calls (see "Pass budget" below) and declares every budget from the COLD figure.
 *
 * ⛔ Where a pass's time goes, so nobody optimises the wrong thing. Measured by timing the two
 * halves of `main` in-process against a warmed `App`: `runCheck` (parity — count + slug +
 * `existsSync`) is **302ms, 3%**; `runContentCheck` (one `exportDocs({dryRun:true})` body probe per
 * type) is **11,457ms, 97%**. Commit `90951390` (2026-08-17) added that probe to `--check`, which
 * had been parity-only, and touched no timeout literal in this file.
 *
 * ⛔ Two corollaries, both of which have already been got wrong once:
 *   - `--check` NEVER spawns `lore list` — `main` runs in-process against a real `App` — so no
 *     `lore list`-side change can shrink a pass. `knowledge-two-attributions-in-the-corpus-growth-threshold`
 *     records a prior handoff proposing exactly that and establishes it "cannot shrink those runs
 *     by one millisecond". Do not cite a `lore list` timing as `--check`'s cost.
 *   - That 97% residual is NOT this file's to fix and MUST NOT be worked around here — no
 *     parity-only flag, no incremental check. It is filed as
 *     `task-the-mirror-check-absorbed-the-content-probe-in-90951390`. The only lever this file has
 *     is HOW MANY passes it spends, which is what the pass budget below is about.
 *
 * **D2 — this file used to mutate shared real state that sibling test files read concurrently.**
 * `vitest.config.ts` leaves `fileParallelism` at its default (true) with `maxWorkers: 4`, so this
 * file and `scripts/tests/mirror-status-parity.test.ts` run in DIFFERENT worker processes
 * SIMULTANEOUSLY. While a mutation case here held a real mirror file deleted (a 30–60s window),
 * that sibling walked `.lore/export-index.json`, called `existsSync` on every mapped path, and
 * legitimately recorded `file_absent` — so a failure in THIS file presented as a failure in an
 * unrelated one. Every mutation below is now confined to a byte-for-byte `cpSync` COPY of the real
 * tree (see "Isolation" below).
 *
 * ⛔ The earlier diagnosis "the restore step never runs on timeout" is FALSE, and was measured
 * false (2026-08-25). Every mutation body here is fully synchronous on the mutation path
 * (`spawnSync`/`readFileSync`/`unlinkSync`/`writeFileSync`, no `await` between mutate and restore),
 * and a synchronous body cannot be interrupted by the runner's timer — it runs to completion,
 * `finally` executes, and only then is "Test timed out" reported. Probe: a 1000ms-budget case with
 * an `unlinkSync`, a `spawnSync("sleep",["3"])`, and a restoring `finally` FAILED with "Test timed
 * out in 1000ms" AND left the file present with its original bytes. Confirmed again end-to-end:
 * the pre-fix revision of this file failed 9 of its e2e cases and left `git status --porcelain
 * docs/requirements .lore/export-index.json` EMPTY afterwards. So "make restoration unconditional"
 * is a no-op — restoration was already unconditional and already byte-verified inside each block.
 * The defect was never the restore; it was that the mutation targeted SHARED state at all.
 *
 * **D3 — `maxBuffer: 20 * 1024 * 1024` was already exceeded, and it failed as a LIE.** See
 * {@link MAX_SUBPROCESS_BUFFER_BYTES} and {@link assertSpawnCompleted}.
 *
 * ## Isolation — a `cpSync` copy of the real tree, read against the REAL corpus
 *
 * Every case that MUTATES a file mutates it inside {@link mirrorSandbox}: a
 * `mkdtempSync(tmpdir(), "lore-mirror-export-")` root holding a byte-for-byte `cpSync` copy of
 * `docs/requirements/` plus `.lore/export-index.json` (which `loadMirrorMappings(repoRoot)` and
 * `exportDocs({projectDir})` both read from THERE, not from the real checkout).
 *
 * ⛔ A COPY of the real tree read against the REAL corpus database is NOT a seeded fixture, and
 * this distinction is load-bearing — do not "fix" these cases back onto a `lore init` fixture. The
 * user decided this explicitly. What AC-FR-6/AC-FR-10 forbid is a corpus of INVENTED documents,
 * whose counts and ids prove nothing about production (the sibling AC-FR-1 went green on a
 * self-seeded corpus while 7 of 8 checkpoints were empty in production). Here the corpus is the
 * production corpus, every doc count comes from a real `lore list` against it, and every mirror
 * byte is a copy of a production mirror byte. The copy changes only WHO CAN SEE the mutation: no
 * other process can name a `mkdtemp` path, whereas `docs/requirements/` is read by at least one
 * concurrently-scheduled sibling suite.
 *
 * The two cases that must observe PRODUCTION state rather than a copy — AC-FR-10 HAPPY (a+b) and
 * (c), which assert the real mirror's parity and link integrity — read the real tree and mutate
 * nothing.
 *
 * ## Delta assertions instead of clean-baseline preconditions
 *
 * A "first prove the whole mirror is clean" precondition is (i) a full extra `--check` pass, and
 * (ii) a clean-tree dependence — which under real concurrency is unobtainable, not merely slow
 * (root CLAUDE.md's North Star: an answer that relies on an exclusive clean checkout "is a refusal
 * of the target state, not a design"). Measured here: a peer session's `lore claim` re-drifts the
 * mirror at will, and `--check` then exits 2 corpus-wide, which is exactly why all nine of those
 * preconditions were failing at `expect(baseline.exitCode).toBe(0)`.
 *
 * So every case whose AC does not require a clean start now asserts a DELTA: capture the
 * observable BEFORE mutating, mutate, capture AFTER, and assert the difference — the target slug
 * is named AFTER and was NOT named BEFORE. A delta is strictly STRONGER than a clean-start
 * assumption (it proves the mutation CAUSED the change, rather than inheriting a state some other
 * test left behind) and it is clean-tree-independent.
 *
 * AC-FR-7's own words are "reports the same drift both times" — IDENTITY between two consecutive
 * runs, never "reports OK" — so its HAPPY case asserts output identity plus an unchanged file-hash
 * manifest, which is both closer to the AC text and free of any clean-tree dependence.
 *
 * ## Pass budget: 13 → 5 `--check` subprocess calls
 *
 *   1  {@link sandboxCheckBaseline}   — memoized, ONE pass, shared by BOTH `drift-check-is-separate` cases
 *   1  drift-check-is-separate HAPPY  — the second consecutive run, for the identity assertion
 *   2  drift-check-is-separate NEG    — the two post-mutation runs AC-FR-7 requires ("BOTH consecutive runs")
 *   1  export-covers-corpus HAPPY     — the real-tree spec-parity check AC-FR-6 names
 *   ─
 *   5  total (was 13; the nine per-case baselines are gone, not merely hoisted — seven became
 *      delta assertions that need no pass at all, and two collapsed into the shared memo)
 *
 * ## Six-dimension coverage for the pure suites
 *   HAPPY:      every spec mapped + file present -> ok; a chain reaching its target via one level
 *               of `bun run` indirection
 *   NEGATIVE:   a spec with no mapping is `no_mapping`; a mapped-but-absent file is `file_absent`;
 *               a chain that never references the target anywhere returns false
 *   BOUNDARY:   an orphan file (fileCountOnDisk > specs.length) fails parity even with `missing`
 *               empty; a self-referencing chain terminates instead of looping
 *   ERROR:      an empty corpus against a non-empty on-disk count still fails parity (arithmetic
 *               is independent of `missing`); a `rootScriptName` absent from `scripts` returns
 *               false rather than throwing
 *   STATE:      multiple missing specs are ALL named, not just the first
 *   REGRESSION: a target string that exists as its OWN standalone, never-referenced script entry
 *               is NOT reachable from an unrelated root (this repo's own prior `check:*` pattern)
 *
 * Side-effect class: IO — spawns `bun`/`git` subprocesses, reads this repo's live corpus and
 * `docs/requirements/`, and WRITES only inside its own `mkdtemp` sandbox. ⛔ It never creates,
 * edits, or deletes a corpus DOC, and never writes a byte under `docs/requirements/` or `.lore/`.
 * The `beforeAll`/`afterAll` porcelain DELTA guard below is the mechanized proof of that claim.
 *
 * @spec_ref spec-falsifiability-reachability-a-feedable-checkpoint-an D6, AC-FR-6, AC-FR-7, AC-FR-10
 * @spec_ref spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check AC-OX-1
 * @spec_ref spec-a-test-case-s-timeout-budget-must-be-declared-when-its D1/D2/D4
 */

import { RecordLockService } from "../../packages/lore/src/service/record-lock-service.js";
import { GateEnforcer } from "../../packages/lore/src/service/gate-enforcer.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExportIndexMapping, MirrorHumanId } from "@lore/core";
import { NoOpTelemetry, assertIsMirrorHumanId } from "@lore/core";
import {
  computeMirrorParity,
  scriptChainReachesTarget,
  loadMirrorMappings,
  countMdFilesFlat,
  EXPORT_INDEX_RELATIVE,
  MIRROR_DRIFT_EXIT_CODE,
  SPEC_MIRROR_DIR_RELATIVE,
  MIRROR_TYPES,
  mirrorDirRelative,
  type MirrorDocType,
} from "../export-spec-mirror-core.js";
import { InMemoryStore } from "../../packages/lore/src/store/in-memory-store.js";
import { CorpusService } from "../../packages/lore/src/service/corpus-service.js";
import { MigrationService } from "../../packages/lore/src/service/migration-service.js";
import { ReviewService } from "../../packages/lore/src/service/review-service.js";
import { VersionService } from "../../packages/lore/src/service/version-service.js";
import { OutlineService } from "../../packages/lore/src/service/outline-service.js";
import { TreeCheckService } from "../../packages/lore/src/service/tree-check-service.js";
import { runMigrationCoverage } from "../../packages/lore/src/eval/scenarios/migration-coverage.js";
import type { App } from "../../packages/lore/src/app.js";

/**
 * Narrows a raw human_id string literal to the branded {@link MirrorHumanId} for fixture
 * construction — via {@link assertIsMirrorHumanId}, never a textual `as MirrorHumanId` cast
 * (`scripts/check-ordinal-write-sites.mjs`'s rule (c) confines that cast to
 * `packages/core/src/schemas.ts` alone; a fixture file is not that file).
 */
function brandedHumanId(value: string): MirrorHumanId {
  assertIsMirrorHumanId(value);
  return value;
}

// ─── Path setup ─────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");
const DOCS_REQUIREMENTS_RELATIVE = join("docs", "requirements");
// `.js` specifier — Bun resolves this to the sibling `.ts` source (project CLAUDE.md "Import
// style"). Imported by the generated driver subprocess ONLY, never by this vitest worker:
// `export-spec-mirror.ts` top-level-imports `createApp` -> `bun:sqlite`, unresolvable in-worker.
const MIRROR_SCRIPT_JS_SPECIFIER = join(REPO_ROOT, "scripts", "export-spec-mirror.js");

// ─── Measured timing constants — the SSOT for every declared budget below ────
//
// Measured 2026-08-25 on this corpus (1741 mirror files, six types) for ONE
// `export-spec-mirror.ts --check` pass. ⛔ These are the numbers every `it(..., budget)` third
// argument below is derived FROM; a budget written without citing them is the D1 defect returning.
// Re-measure them, do not re-guess them, if a pass's cost changes.

/** One `--check` pass, COLD (fresh worktree: no bun transpile cache, no page cache on the corpus). Every budget below is derived from THIS figure, never the warm one. Corroborated by `knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in`'s last-green measurements of 28298ms and 27931ms. */
const CHECK_PASS_COLD_MS = 27_900;
/** One `--check` pass, WARM (measured 12.3–14.5s across the 9 e2e passes of a full pre-fix run in this worktree). Recorded for contrast only: budgeting on the WARM figure is precisely what produced the D1 timeouts, since a fresh worktree always pays cold. */
const CHECK_PASS_WARM_MS = 13_800;

/**
 * A case's declared timeout budget, as ARITHMETIC rather than a comment's claim: `passes` full
 * `--check` passes priced at the COLD figure ({@link CHECK_PASS_COLD_MS}; never
 * {@link CHECK_PASS_WARM_MS}), plus `otherWorkMs` for everything else that case does — `lore list`
 * subprocess reads, in-process migration-coverage passes, the one-off sandbox `cpSync`, and slack
 * for a loaded machine.
 *
 * ⛔ Every `it(..., budgetMs(n, m))` below therefore DECLARES its own pass count where a reader (and
 * a grep) can see it. That is the D1 fix's durable half: the pre-fix budgets were bare literals
 * (`30000`) with no recorded relationship to the number of passes their case made, so when commit
 * `90951390` tripled a pass's cost nothing connected the two and the literals silently went stale.
 *
 * `spec-a-test-case-s-timeout-budget-must-be-declared-when-its` judges DECLARATION, never the
 * value; `scripts/check-test-budgets.ts` accepts any non-empty third argument (its own comment:
 * "its value/shape … is never inspected"), so an expression satisfies it exactly as a literal does.
 */
function budgetMs(passes: number, otherWorkMs: number): number {
  return passes * CHECK_PASS_COLD_MS + otherWorkMs;
}

/**
 * ⛔ D3 — the buffer that must fit the measured population, not a round number someone liked.
 *
 * Measured 2026-08-25, the six `lore list --type <t> --json --include-invalid` payloads this file
 * reads (bytes): prd 38,359 / adr 267,917 / plan 492,093 / spec 2,805,635 / task 9,026,320 /
 * **knowledge 23,180,068**. The previous `20 * 1024 * 1024` (20,971,520) was ALREADY exceeded by
 * knowledge by 2,208,548 bytes — and it failed as a LIE rather than as a limit; see
 * {@link assertSpawnCompleted}.
 *
 * 64 MiB is ~2.9x the measured worst case. ⛔ That headroom is a schedule, not a fix: the worst
 * case GROWS MONOTONICALLY with the corpus, so this constant is on the same treadmill the 20 MiB
 * one fell off. The structural residual is field projection on `lore list` (`--fields`), so this
 * oracle stops transferring orders of magnitude more data than it reads — it consumes only
 * `{id, slug}` per doc, a ratio already measured in
 * `knowledge-two-attributions-in-the-corpus-growth-threshold`; decided direction, not restated here.
 *
 * ⛔ That residual buys back THIS buffer and nothing else. The same doc establishes that field
 * projection "cannot shrink those runs by one millisecond", i.e. it is irrelevant to a `--check`
 * pass, which never spawns `lore list` at all (see the D1 corollaries above). Do not conflate the
 * two costs: the buffer is about the six `lore list` payloads this FILE reads; the pass cost is
 * `runContentCheck`'s, and it is filed elsewhere.
 */
const MAX_SUBPROCESS_BUFFER_BYTES = 64 * 1024 * 1024;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * ⛔ D3's mechanism half: fails LOUD when a `spawnSync` did not run to completion.
 *
 * `spawnSync` past `maxBuffer` SIGTERMs the child and returns `status: null` with an ENOBUFS
 * `error` and (measured) an EMPTY stderr. The previous `result.status ?? 1` collapsed that into
 * exit code **1** — a code the child never returned — so the resulting failure read
 * `test setup: lore list --type knowledge --json --include-invalid failed (exit 1):` with nothing
 * after the colon, i.e. "the CLI is broken". The CLI was fine. That silent fallback is what made
 * a buffer overflow indistinguishable from a genuine CLI failure, and it is the reason D3 went
 * undiagnosed while it was already firing.
 *
 * Measured shape of the failure this refuses (2026-08-25, `maxBuffer: 20 * 1024 * 1024` against
 * `lore list --type knowledge`): `status: null`, `signal: "SIGTERM"`, `error.code: "ENOBUFS"`,
 * `error.message: "spawnSync bun ENOBUFS (stdout or stderr buffer reached maxBuffer size limit)"`,
 * `stdout.length: 22147997`, `stderr.length: 0`. Same probe, same diagnosis, recorded 2026-08-24 as
 * "Failure 1" of `knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in`, which names the
 * `?? 1` collapse "the repo's own banned pattern" — sitting, at the time, inside a helper whose own
 * comment claimed it obeyed this repo's anti-truncation discipline. ⛔ A comment asserting a
 * discipline is not the discipline; this function is, and it is why `?? 1` cannot return here.
 *
 * @throws {Error} naming the label, the observed status/signal/error code, and — for ENOBUFS —
 *   the exact `maxBuffer` the call was given, so the message points at the constant to raise
 *   instead of at the child.
 */
function assertSpawnCompleted(
  label: string,
  result: ReturnType<typeof spawnSync>,
  maxBufferBytes: number,
): number {
  const spawnError = result.error as NodeJS.ErrnoException | undefined;
  if (spawnError !== undefined || result.status === null) {
    const capturedBytes = (result.stdout ?? "").length + (result.stderr ?? "").length;
    const enobufsDetail =
      spawnError?.code === "ENOBUFS"
        ? ` The child's stdout/stderr reached the maxBuffer of ${maxBufferBytes} bytes, so spawnSync SIGTERM'd it and its output (${capturedBytes} bytes captured) is TRUNCATED, not a result. Raise MAX_SUBPROCESS_BUFFER_BYTES — do not read the truncated output, and do not read this as a failure of the command.`
        : "";
    throw new Error(
      `${label}: subprocess did not run to completion — status=${String(result.status)} signal=${String(result.signal)} error.code=${spawnError?.code ?? "none"} error.message=${spawnError?.message ?? "none"}.${enobufsDetail} ⛔ Never reported as an exit code: \`status ?? 1\` would fabricate a code the child never returned.`,
    );
  }
  return result.status;
}

/**
 * ⛔ The ASYNC sibling of {@link assertSpawnCompleted}, for the long `--check` passes — and the
 * reason it exists is a root cause, not a preference.
 *
 * `spawnSync` blocks the vitest worker's event loop for the whole subprocess. A `--check` pass is
 * 13.8–31s of that, and once a run accumulates roughly a minute of it the worker can no longer
 * answer the reporter's `onTaskUpdate` RPC, so vitest raises
 * `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` as an UNHANDLED ERROR. The run then
 * prints `Tests N passed` and still exits **1** — a green suite behind a red exit code, i.e. an
 * oracle whose verdict cannot be read from its exit status.
 *
 * Measured across this file's own runs (2026-08-25): the two runs with ~62s of cumulative
 * synchronous blocking (5 x ~13s pre-fix; 2 x ~31s post-fix) BOTH raised it; the runs at ~26s and
 * below did not. ⛔ Not fixed by raising a vitest timeout — that would hide a starved worker rather
 * than feed it. Awaiting the subprocess yields the loop, so the heartbeat is serviced while the
 * child runs, and the wall-clock cost is unchanged.
 *
 * Keeps D3's discipline on the async path too: an exit code is returned ONLY when the child
 * actually returned one, and the output cap fails LOUD (naming the cap) instead of handing back
 * silently truncated bytes.
 */
async function spawnCaptureAsync(
  label: string,
  command: string,
  args: readonly string[],
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: REPO_ROOT, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    let killedForBuffer = false;

    const guardBuffer = (): void => {
      if (!killedForBuffer && stdout.length + stderr.length > MAX_SUBPROCESS_BUFFER_BYTES) {
        killedForBuffer = true;
        child.kill("SIGTERM");
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; guardBuffer(); });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; guardBuffer(); });

    child.on("error", (e: Error) => {
      reject(new Error(`${label}: failed to spawn — ${e.message}`));
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (killedForBuffer) {
        reject(new Error(
          `${label}: output exceeded MAX_SUBPROCESS_BUFFER_BYTES (${MAX_SUBPROCESS_BUFFER_BYTES}); the child was SIGTERM'd and its ${stdout.length + stderr.length} captured bytes are TRUNCATED, not a result. Raise the constant — do not read the truncated output, and do not read this as a failure of the command.`,
        ));
        return;
      }
      if (code === null) {
        reject(new Error(
          `${label}: subprocess did not run to completion — exited on signal=${String(signal)} with no exit code. ⛔ Never reported as an exit code: \`code ?? 1\` would fabricate a code the child never returned.`,
        ));
        return;
      }
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/** Spawns `bun run <LORE_ENTRY> ...args` against the REPO ROOT — a read-only corpus query in every call site this file makes. Fails loud (never a fabricated exit code) via {@link assertSpawnCompleted}. Stays SYNCHRONOUS deliberately: each of these reads is a few seconds at most, far below the cumulative-blocking threshold documented on {@link spawnCaptureAsync}, and several call sites feed synchronous `computeMirrorParity` callbacks. */
function runLore(args: string[]): RunResult {
  const result = spawnSync("bun", ["run", LORE_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: MAX_SUBPROCESS_BUFFER_BYTES,
    env: { ...process.env, CLAUDECODE: "1" },
  });
  const exitCode = assertSpawnCompleted(`lore ${args.join(" ")}`, result, MAX_SUBPROCESS_BUFFER_BYTES);
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode };
}

/** Reads the REAL root `package.json`'s `scripts` map fresh from disk — never a cached/hardcoded copy, so a manual edit during RED verification is picked up immediately. */
function readRealPackageScripts(): Record<string, string> {
  const raw = readFileSync(PACKAGE_JSON_PATH, "utf8");
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
  if (!parsed.scripts) throw new Error(`${PACKAGE_JSON_PATH} has no "scripts" section`);
  return parsed.scripts;
}

/** Live corpus spec (id, slug) pairs via a real `lore list --type spec --json` subprocess — the AC-FR-6-mandated "never a literal typed into the test" source of truth. */
function readLiveCorpusSpecs(): { id: string; slug: string }[] {
  const result = runLore(["list", "--type", "spec", "--json"]);
  if (result.exitCode !== 0) {
    throw new Error(`test setup: lore list --type spec --json failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as { data: { docs: { id: string; slug: string }[] } };
  return parsed.data.docs.map((d) => ({ id: d.id, slug: d.slug }));
}

/** Full live parity snapshot for ONE repo root (specs from the live corpus, mappings + on-disk state from `root`) as of the moment this is called — a fresh re-derivation every time, never reused across a mutation. */
function measureParityAt(root: string): {
  specs: { id: string; slug: string }[];
  mappings: Record<string, ExportIndexMapping>;
  fileCountOnDisk: number;
  fileExists: (relPath: string) => boolean;
} {
  const specs = readLiveCorpusSpecs();
  const mappings = loadMirrorMappings(root);
  const fileCountOnDisk = countMdFilesFlat(join(root, SPEC_MIRROR_DIR_RELATIVE));
  const fileExists = (relPath: string): boolean => existsSync(join(root, relPath));
  return { specs, mappings, fileCountOnDisk, fileExists };
}

// ─── AC-2(b): the working-tree DELTA guard ───────────────────────────────────
//
// ⛔ Asserts the DELTA, never "porcelain is empty". Another session may legitimately have the tree
// dirty while this suite runs (this repo is developed by many concurrent sessions), so a
// clean-tree assertion here would be exactly the exclusivity the North Star forbids — and it would
// fail for reasons having nothing to do with this file. What this file OWES is that it changed
// NOTHING: identical porcelain before and after.

/** `git status --porcelain` scoped to the two paths this file must never modify. */
function porcelainForGuardedPaths(): string {
  const result = spawnSync(
    "git",
    ["status", "--porcelain", DOCS_REQUIREMENTS_RELATIVE, EXPORT_INDEX_RELATIVE],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: MAX_SUBPROCESS_BUFFER_BYTES },
  );
  assertSpawnCompleted("git status --porcelain (working-tree delta guard)", result, MAX_SUBPROCESS_BUFFER_BYTES);
  return result.stdout ?? "";
}

let porcelainAtSuiteStart: string | null = null;

beforeAll(() => {
  porcelainAtSuiteStart = porcelainForGuardedPaths();
});

afterAll(() => {
  // ⛔ Fails loud if ANY case leaked a mutation onto the real tree — the mechanized proof of this
  // file's "writes only inside its own mkdtemp sandbox" claim. Compared against the captured
  // BEFORE, so a tree another session left dirty is inert here while a byte THIS file changed is not.
  expect(porcelainForGuardedPaths()).toBe(porcelainAtSuiteStart);
});

// ─── The mutation sandbox: a byte-for-byte copy of the real tree ──────────────

interface MirrorSandbox {
  /** The `mkdtemp` root, usable as `export-spec-mirror.ts`'s `repoRootOverride`. */
  readonly root: string;
  /** `<root>/<driver>.ts` — the generated `bun run` entry point that reaches `main(argv, repoRoot)`. */
  readonly driverPath: string;
}

let sandbox: MirrorSandbox | null = null;

/**
 * Lazily creates (and memoizes) the mutation sandbox: a `cpSync` copy of `docs/requirements/` plus
 * `.lore/export-index.json`, which is everything `runCheck` / `runContentCheck` /
 * `loadMirrorMappings` read from a repo root.
 *
 * ⛔ Lazy on purpose: the two AC-FR-10 HAPPY cases assert PRODUCTION state and need no sandbox, so
 * a `beforeAll` that built it unconditionally would charge every `-t` filter for a copy it may not
 * use.
 *
 * The corpus DB is NOT copied and NOT overridden — the driver lets `main` resolve it exactly as
 * `bun run scripts/export-spec-mirror.ts --check` does (from `cwd`, which is `REPO_ROOT`). So the
 * sandbox run reads the SAME production corpus the real command reads; only the on-disk mirror it
 * is compared against is the private copy. Under `--check` that is read-only: `runCheck` only
 * lists docs, and `runContentCheck`'s `exportDocs({dryRun:true})` has every write site behind a
 * `dryRun` guard (verified in that function's own header).
 */
function mirrorSandbox(): MirrorSandbox {
  if (sandbox !== null) return sandbox;

  const root = mkdtempSync(join(tmpdir(), "lore-mirror-export-"));
  cpSync(join(REPO_ROOT, DOCS_REQUIREMENTS_RELATIVE), join(root, DOCS_REQUIREMENTS_RELATIVE), {
    recursive: true,
  });
  mkdirSync(join(root, ".lore"), { recursive: true });
  copyFileSync(join(REPO_ROOT, EXPORT_INDEX_RELATIVE), join(root, EXPORT_INDEX_RELATIVE));

  // The driver replicates `export-spec-mirror.ts`'s OWN `import.meta.main` error mapping, so a
  // SpecMirrorError surfaces as the documented hard-failure code rather than as bun's generic 1 —
  // otherwise "exits EXACTLY MIRROR_DRIFT_EXIT_CODE" could not distinguish drift from a crash.
  const driverPath = join(root, "mirror-export-check-driver.ts");
  writeFileSync(
    driverPath,
    `
import { main, SpecMirrorError } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)};
import { MIRROR_HARD_FAILURE_EXIT_CODE } from ${JSON.stringify(join(REPO_ROOT, "scripts", "export-spec-mirror-core.js"))};

const repoRoot = process.argv[2];
try {
  process.exit(await main(["--check"], repoRoot));
} catch (e) {
  if (e instanceof SpecMirrorError) {
    console.error(\`export-spec-mirror: \${e.message}\`);
    if (e.context) console.error(JSON.stringify(e.context));
    process.exit(MIRROR_HARD_FAILURE_EXIT_CODE);
  }
  console.error(\`export-spec-mirror: failed — \${e instanceof Error ? e.message : String(e)}\`);
  process.exit(MIRROR_HARD_FAILURE_EXIT_CODE);
}
`,
    "utf8",
  );

  sandbox = { root, driverPath };
  return sandbox;
}

afterAll(() => {
  if (sandbox === null) return;
  const { root } = sandbox;
  sandbox = null;
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // best-effort cleanup — a leftover temp dir must never fail the run
  }
});

interface CheckResult extends RunResult {
  /** stdout + stderr — `printParity` writes the OK/count lines to stdout and drift findings to stderr. */
  readonly output: string;
}

/**
 * Runs ONE read-only `--check` pass against the sandbox copy (AC-OX-1: `--check`, always).
 * ⛔ Each call is a full ~{@link CHECK_PASS_COLD_MS}-cold / ~{@link CHECK_PASS_WARM_MS}-warm pass —
 * count them against the declared budget of whatever case calls this.
 */
async function runSandboxCheck(): Promise<CheckResult> {
  const { root, driverPath } = mirrorSandbox();
  const { stdout, stderr, exitCode } = await spawnCaptureAsync(
    "export-spec-mirror --check (sandbox)",
    "bun",
    ["run", driverPath, root],
  );
  return { stdout, stderr, exitCode, output: `${stdout}\n${stderr}` };
}

let cachedSandboxBaseline: Promise<CheckResult> | null = null;

/**
 * The ONE shared `--check` baseline over the UNMUTATED sandbox — memoized, so the two
 * `drift-check-is-separate` cases pay for it once between them rather than once each.
 *
 * ⛔ This is a BEFORE observation for a delta, NOT a "the mirror is clean" precondition. It is
 * expected to exit {@link MIRROR_DRIFT_EXIT_CODE} whenever the shared corpus is drifted (a peer
 * session's `lore claim` is enough), and nothing below asserts otherwise. Its value is that a slug
 * absent HERE and present AFTER a mutation was put there BY that mutation.
 */
function sandboxCheckBaseline(): Promise<CheckResult> {
  // Memoizes the PROMISE, not the value — so two cases awaiting it concurrently still spend ONE
  // pass between them rather than racing into two.
  cachedSandboxBaseline ??= runSandboxCheck();
  return cachedSandboxBaseline;
}

/**
 * sha256-per-file manifest of every `.md` under one root's `docs/requirements/`, as a sorted
 * `relpath  hash` block. The instrument for "the check regenerated nothing": a byte-level
 * measurement of the tree, immune to any concurrent corpus write.
 */
function hashManifest(root: string): string {
  const base = join(root, DOCS_REQUIREMENTS_RELATIVE);
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        lines.push(`${relative(base, abs)}  ${createHash("sha256").update(readFileSync(abs)).digest("hex")}`);
      }
    }
  };
  walk(base);
  return lines.sort().join("\n");
}

/**
 * Projects a `--check` report onto the part determined SOLELY by the on-disk mirror tree: the
 * per-type `N file(s) on disk under <dir>` figures, in report order.
 *
 * ⛔ This is the ONLY part of the report a two-consecutive-runs identity assertion may compare, and
 * the reason is a measured flake, not caution. `--check`'s output mixes two sources:
 *
 *   - ON-DISK, and frozen for the life of the sandbox: `countMdFilesFlat`'s per-type file counts.
 *   - CORPUS, shared and concurrently WRITABLE by every other session: `printParity`'s
 *     `, M live corpus <type>(s).` counts, its `<slug> — never exported (no export-index mapping)`
 *     lines (a doc created mid-window adds one), and `printContentDrift`'s
 *     `<slug> — body differs from the corpus document` lines (a doc EDITED mid-window adds one).
 *
 * Measured 2026-08-25: comparing the full report — even with the live counts masked — FAILED when
 * this file ran alongside `mirror-status-parity.test.ts` while a peer session was actively creating
 * corpus docs, because a new `never exported` line appeared between run 1 and run 2. That is the
 * corpus changing, NOT the check repairing, so an assertion that reddens on it is measuring the
 * wrong thing and would be a flake in every concurrent run.
 *
 * What AC-FR-7 actually forbids is the check WRITING (repairing what it inspects). A repair
 * necessarily moves these on-disk counts — and, more directly still, it moves the
 * {@link hashManifest} the HAPPY case samples three times. Both instruments are functions of the
 * frozen tree alone, so both are immune to any concurrent corpus write.
 */
function onDiskFileCountProjection(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.match(/^export-spec-mirror \(check\): (\d+ file\(s\) on disk under \S+)/)?.[1])
    .filter((m): m is string => m !== undefined);
}

// ─── AC-FR-10: all-types-parity-and-id-format helpers ────────────────────────
//
// spec-falsifiability-reachability-a-feedable-checkpoint-an D6, AC-FR-10 (task-unify-mirror-
// identifiers-on-zero-padded-form-export-all, 2026-08-11) — widens AC-FR-6/AC-FR-7's spec-only
// scope to all six mirrored doc types, and adds two NEW invariants AC-FR-6 never asserted:
// (b) every mirror file's frontmatter `id:` is byte-identical to its filename's leading
// identifier, zero-padded to 3 digits; (c) the migration-coverage eval over docs/requirements
// reports links_broken === 0. ⛔ Asserted against THIS repo's PRODUCTION corpus — the sibling
// AC-FR-1 (a different plan) went green on a self-seeded corpus while 7 of 8 checkpoints were
// empty in production, which is exactly the failure mode a fixture-only proof would repeat here.

/** Live corpus (id, slug) pairs for ONE {@link MirrorDocType} via a real `lore list --type <t>
 *  --json --include-invalid` subprocess. `--include-invalid` matches EXACTLY what
 *  `ExportDocsService.exportDocs` itself walks (`StoreInterface.findMany` has no invalidation
 *  filter at all — that filter is a `CorpusService.list()`-only post-filter, SPEC-043 D3);
 *  omitting the flag would make knowledge/adr/task counts structurally NEVER match the mirror,
 *  for a reason having nothing to do with padding or missing exports.
 *
 *  ⛔ `knowledge` is the 23,180,068-byte read that D3's {@link MAX_SUBPROCESS_BUFFER_BYTES} exists
 *  for; if this ever throws {@link assertSpawnCompleted}'s ENOBUFS message, the constant is stale
 *  again — do not read the truncated output. */
function readLiveCorpusDocsIncludingInvalid(type: MirrorDocType): { id: string; slug: string }[] {
  const result = runLore(["list", "--type", type, "--json", "--include-invalid"]);
  if (result.exitCode !== 0) {
    throw new Error(`test setup: lore list --type ${type} --json --include-invalid failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as { data: { docs: { id: string; slug: string }[] } };
  return parsed.data.docs.map((d) => ({ id: d.id, slug: d.slug }));
}

/** Every `.md` file's basename directly under one root's mirror directory for `type` (non-recursive, matches {@link countMdFilesFlat}'s own scope). */
function listMirrorFilenamesAt(root: string, type: MirrorDocType): string[] {
  const dir = join(root, mirrorDirRelative(type));
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name);
}

/** Extracts the frontmatter `id:` scalar from a file's raw content — a minimal, test-local regex parse (mirrors `export-docs-service.test.ts`'s own `parseFrontmatterScalars`, not shared, since that file lives in a different package and this repo's convention keeps test helpers local per SPEC-013's eval CLAUDE.md note on fixtures). Returns `null` if no strict frontmatter block or no `id:` line is found. */
function extractIdFromFileContent(content: string): string | null {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  for (const line of (match[1] ?? "").split("\n")) {
    if (line.startsWith("id:")) return line.slice("id:".length).trim();
  }
  return null;
}

/** Extracts the leading `{PREFIX}-{digits}` identifier from a mirror filename, e.g. `"SPEC-021-foo.md"` → `"SPEC-021"`. Returns `null` if the filename has no such leading segment. */
function extractFilenameLeadingId(filename: string): string | null {
  const match = filename.match(/^([A-Za-z]+-\d+)-/);
  return match?.[1] ?? null;
}

/** True iff `id`'s numeric suffix is zero-padded to AT LEAST 3 digits (`padStart(3,"0")` round-trips to itself) — the canonical mirror form (task-unify-mirror-identifiers-on-zero-padded-form-export-all, 2026-08-11). */
function isThreeDigitPadded(id: string): boolean {
  const match = id.match(/^[A-Za-z]+-(\d+)$/);
  if (!match) return false;
  const digits = match[1] as string;
  return digits.padStart(3, "0") === digits;
}

/** Builds a throwaway `App` backed by `InMemoryStore` — the SAME construction `packages/lore/tests/unit/eval/migration-coverage.test.ts::makeApp` uses, duplicated here (not imported — that file is a `packages/lore`-internal test, this one lives under `scripts/tests/`, and this repo's convention keeps eval-scenario test fixtures local rather than exporting a shared test-only App builder from `src/`). NEVER touches this repo's own corpus — `MigrationService`/`InMemoryStore` here operate entirely in memory. */
function makeThrowawayApp(): App {
  const store = new InMemoryStore();
  const telemetry = new NoOpTelemetry();
  return {
    corpusService: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), telemetry),
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: null as unknown as App["apiKeyStore"],
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry,
    close: () => { telemetry.close(); },
  };
}

/** `links_broken` from one migration-coverage pass over `<root>/docs/requirements` — the AC-FR-10(c) observable, measured fresh on every call so it can serve as a delta endpoint. */
async function measureLinksBrokenAt(root: string): Promise<{ links_broken: number; expected_files: number; passed: boolean }> {
  const app = makeThrowawayApp();
  try {
    const result = await runMigrationCoverage(join(root, DOCS_REQUIREMENTS_RELATIVE), app);
    return { links_broken: result.links_broken, expected_files: result.expected_files, passed: result.passed };
  } finally {
    app.close();
  }
}

describe("all-types-parity-and-id-format: AC-FR-10 end-to-end against the REAL production corpus (all six doc types, never a fixture)", () => {
  it(
    "HAPPY (a+b): for every mirrored doc type, on-disk file count equals the live corpus count, and every mirror file's frontmatter id: is byte-identical to its filename's zero-padded leading identifier",
    () => {
      // ⛔ Reads PRODUCTION state and mutates nothing — AC-FR-10(a)/(b) are assertions ABOUT the
      // real mirror, so a sandbox copy would prove nothing here. No `--check` pass: this case
      // re-derives parity itself from `lore list` + `readdirSync`, so the pass the pre-fix revision
      // spent on a clean-baseline precondition was pure redundancy (and, being corpus-wide, it was
      // also the assertion that made this case fail for reasons outside its own scope).

      // ── Phase 1: perform ALL SIX live-corpus reads BEFORE asserting anything. ──
      // ⛔ Load-bearing ordering, not style. `MIRROR_TYPES` is [prd, spec, adr, knowledge, plan,
      // task]; the pre-fix revision asserted parity inside the loop, so a mismatch on `spec` (2nd)
      // aborted the case before it ever issued the `knowledge` (4th) read — the 23,180,068-byte one
      // that D3's MAX_SUBPROCESS_BUFFER_BYTES exists for. That made the buffer fix UNREACHABLE from
      // this case whenever any earlier type drifted: the oracle would have gone green on a raised
      // buffer it never exercised, and red on a lowered one for the wrong reason. Reading first and
      // asserting second is what gives this case discriminating power over D3 at all. (Measured
      // 2026-08-25: with one unexported spec in the corpus, the in-loop form died at `spec` in
      // 725ms, never touching `knowledge`.)
      const perType = MIRROR_TYPES.map((type) => ({
        type,
        liveDocs: readLiveCorpusDocsIncludingInvalid(type),
        filenames: listMirrorFilenamesAt(REPO_ROOT, type),
      }));
      expect(perType).toHaveLength(MIRROR_TYPES.length);

      // ── Phase 2: collect EVERY violation, then assert. ──
      // Reporting all of them, rather than dying on the first, is the STATE dimension the pure
      // suite already asserts for `computeMirrorParity` ("multiple missing specs are ALL named");
      // it also keeps a count mismatch on one type from masking an id-format defect on another.
      const countMismatches: string[] = [];
      const idViolations: string[] = [];
      let totalFilesChecked = 0;

      for (const { type, liveDocs, filenames } of perType) {
        // (a) exact-count parity, per type, against the LIVE corpus — never a literal.
        if (filenames.length !== liveDocs.length) {
          countMismatches.push(`${type}: ${filenames.length} mirror file(s) on disk vs ${liveDocs.length} live corpus doc(s)`);
        }

        // (b) every mirror file's frontmatter id: is byte-identical to its filename's leading
        // identifier, AND that shared value is zero-padded to (at least) 3 digits.
        for (const filename of filenames) {
          totalFilesChecked += 1;
          const filenameId = extractFilenameLeadingId(filename);
          if (filenameId === null) {
            idViolations.push(`${type}/${filename} has no {PREFIX}-{digits}- leading identifier`);
            continue;
          }
          const absPath = join(REPO_ROOT, mirrorDirRelative(type), filename);
          const frontmatterId = extractIdFromFileContent(readFileSync(absPath, "utf8"));
          if (frontmatterId === null) {
            idViolations.push(`${type}/${filename} has no frontmatter id: line`);
            continue;
          }
          if (frontmatterId !== filenameId) {
            idViolations.push(`${type}/${filename}: frontmatter id: (${frontmatterId}) != filename leading id (${filenameId})`);
          }
          if (!isThreeDigitPadded(frontmatterId)) {
            idViolations.push(`${type}/${filename}: id "${frontmatterId}" is not zero-padded to 3 digits`);
          }
        }
      }

      // Sanity floor FIRST: never a vacuous pass over zero files (an empty tree would satisfy both
      // assertions below trivially, without checking anything real).
      expect(totalFilesChecked).toBeGreaterThan(0);

      expect(idViolations).toEqual([]);
      expect(countMismatches).toEqual([]);
    },
    // Budget: ZERO `--check` passes (one pass costs 27.9s cold / 13.8s warm — see budgetMs). The
    // cost here is 6 `lore list --json --include-invalid` subprocess reads totalling ~35.8MB of
    // JSON (knowledge alone is 23,180,068 bytes) plus a frontmatter parse of every mirror file.
    budgetMs(0, 120_000),
  );

  it(
    "HAPPY (c): the migration-coverage eval over the REAL docs/requirements reports links_broken === 0",
    async () => {
      // ⛔ PRODUCTION tree, no mutation, no `--check` pass — same reasoning as (a+b) above.
      const result = await measureLinksBrokenAt(REPO_ROOT);

      expect(result.expected_files).toBeGreaterThan(0); // sanity floor: never a vacuous empty-dir pass
      expect(result.links_broken).toBe(0);
    },
    // Budget: ZERO `--check` passes (one pass costs 27.9s cold / 13.8s warm — see budgetMs).
    // One in-process migration-coverage pass over ~1741 real mirror files.
    budgetMs(0, 120_000),
  );

  it(
    "RED (a) — live: deleting one exported file of any type makes the per-type count parity check fail, naming that type and slug",
    () => {
      // ⛔ D2: the deletion lands in the mkdtemp SANDBOX, never in `docs/requirements/`. The
      // pre-fix revision deleted the REAL file and held it deleted for tens of seconds while
      // `scripts/tests/mirror-status-parity.test.ts` ran in a concurrent worker and recorded
      // `file_absent` for it — a failure in THIS case presenting as a failure in an unrelated file.
      const { root } = mirrorSandbox();

      // "plan" (never spec — AC-FR-6/AC-FR-7 already cover spec's own RED cases) — any doc with
      // an export-index mapping works; the first one found is as good as any other.
      const type: MirrorDocType = "plan";
      const mappings = loadMirrorMappings(root);
      const liveDocs = readLiveCorpusDocsIncludingInvalid(type);
      const target = liveDocs.find((d) => mappings[d.id] !== undefined);
      if (target === undefined) {
        throw new Error(`test setup: no live ${type} doc has an export-index mapping in the sandbox index`);
      }
      const mapping = mappings[target.id] as ExportIndexMapping;
      const sandboxPath = join(root, mapping.file_path);
      const realPath = join(REPO_ROOT, mapping.file_path);
      const original = readFileSync(sandboxPath, "utf8");

      // BEFORE — the delta's first endpoint. ⛔ Not asserted to be clean: asserted to not yet name
      // the target, which is the only thing the AFTER assertion needs in order to attribute the
      // change to THIS mutation rather than to whatever state the shared tree happened to be in.
      const filenamesBefore = listMirrorFilenamesAt(root, type);
      const parityBefore = computeMirrorParity(
        liveDocs,
        mappings,
        (relPath) => existsSync(join(root, relPath)),
        filenamesBefore.length,
      );
      expect(parityBefore.missing).not.toContainEqual({ slug: target.slug, reason: "file_absent" });

      unlinkSync(sandboxPath);
      try {
        // AC-2(a) — the falsifier with discriminating power: this goes RED the instant someone
        // points the mutation above back at REPO_ROOT.
        expect(existsSync(realPath), `AC-2(a): the mutation escaped the sandbox and deleted the REAL ${mapping.file_path}`).toBe(true);

        const filenamesAfter = listMirrorFilenamesAt(root, type);
        expect(filenamesAfter.length).toBe(filenamesBefore.length - 1);

        const parityAfter = computeMirrorParity(
          liveDocs,
          mappings,
          (relPath) => existsSync(join(root, relPath)),
          filenamesAfter.length,
        );
        expect(parityAfter.ok).toBe(false);
        expect(parityAfter.missing).toContainEqual({ slug: target.slug, reason: "file_absent" });

        // DELTA: the target is named AFTER and was NOT named BEFORE — proof the mutation CAUSED it.
        const newlyMissing = parityAfter.missing.filter(
          (m) => !parityBefore.missing.some((b) => b.slug === m.slug && b.reason === m.reason),
        );
        expect(newlyMissing).toEqual([{ slug: target.slug, reason: "file_absent" }]);
      } finally {
        writeFileSync(sandboxPath, original, "utf8");
        expect(readFileSync(sandboxPath, "utf8")).toBe(original);
      }
    },
    // Budget: ZERO `--check` passes (one pass costs 27.9s cold / 13.8s warm — see budgetMs).
    // One `lore list --type plan` read plus, on first use, the sandbox `cpSync` of ~13MB / 1741 files.
    budgetMs(0, 120_000),
  );

  it(
    "RED (b) — live: rewriting one mirror file's frontmatter id: to the non-padded form fails, naming that exact file",
    () => {
      const { root } = mirrorSandbox();

      const type: MirrorDocType = "adr";
      const filenames = listMirrorFilenamesAt(root, type);
      const target = filenames.find((f) => extractFilenameLeadingId(f) !== null);
      if (target === undefined) {
        throw new Error(`test setup: no ${type} mirror file has a parseable leading identifier`);
      }
      const filenameId = extractFilenameLeadingId(target) as string;
      const numMatch = filenameId.match(/^([A-Za-z]+)-0*(\d+)$/);
      if (numMatch === null) {
        throw new Error(`test setup: ${filenameId} does not parse as {PREFIX}-{digits}`);
      }
      const prefix = numMatch[1] as string;
      const nonPaddedId = `${prefix}-${Number.parseInt(numMatch[2] as string, 10)}`;

      const sandboxPath = join(root, mirrorDirRelative(type), target);
      const realPath = join(REPO_ROOT, mirrorDirRelative(type), target);
      const original = readFileSync(sandboxPath, "utf8");
      const realBytesBefore = readFileSync(realPath, "utf8");

      // BEFORE — the delta's first endpoint: the id currently MATCHES and IS padded.
      expect(extractIdFromFileContent(original)).toBe(filenameId);
      expect(isThreeDigitPadded(filenameId)).toBe(true);

      const mutated = original.replace(/^id: .+$/m, `id: ${nonPaddedId}`);
      expect(mutated).not.toBe(original); // sanity: the replace actually matched something

      writeFileSync(sandboxPath, mutated, "utf8");
      try {
        // AC-2(a) — byte-equality on the REAL counterpart of a rewrite. Goes RED the instant
        // someone points the `writeFileSync` above at REPO_ROOT.
        expect(readFileSync(realPath, "utf8"), `AC-2(a): the mutation escaped the sandbox and rewrote the REAL ${type}/${target}`).toBe(realBytesBefore);

        const rewritten = readFileSync(sandboxPath, "utf8");
        const frontmatterId = extractIdFromFileContent(rewritten);
        expect(frontmatterId).toBe(nonPaddedId);
        // The RED this test demonstrates, as a DELTA off the BEFORE endpoint above: frontmatter
        // id: no longer matches the filename's leading identifier, nor is it 3-digit padded —
        // exactly the AC-FR-10(b) failure shape.
        expect(frontmatterId).not.toBe(filenameId);
        expect(isThreeDigitPadded(frontmatterId as string)).toBe(false);
      } finally {
        writeFileSync(sandboxPath, original, "utf8");
        expect(readFileSync(sandboxPath, "utf8")).toBe(original);
      }
    },
    // Budget: ZERO `--check` passes (one pass costs 27.9s cold / 13.8s warm — see budgetMs).
    // No subprocess at all beyond, on first use, the sandbox `cpSync` of ~13MB / 1741 files.
    budgetMs(0, 120_000),
  );

  it(
    "RED (c) — live: pointing one cross-type reference at a non-existent id makes migration-coverage's links_broken non-zero",
    async () => {
      const { root } = mirrorSandbox();

      // A plan mirror file with at least one links: entry — PLAN-115 (audit-remediation, cited
      // in this task's own root-cause diagnosis) always has outbound spec links on this corpus;
      // fall back to scanning if that exact file ever moves.
      const planFilenames = listMirrorFilenamesAt(root, "plan");
      const target = planFilenames.find((f) => {
        const content = readFileSync(join(root, mirrorDirRelative("plan"), f), "utf8");
        return /^links:\n(  - .*\n)+/m.test(content);
      });
      if (target === undefined) {
        throw new Error("test setup: no plan mirror file has a links: array to corrupt");
      }
      const sandboxPath = join(root, mirrorDirRelative("plan"), target);
      const realPath = join(REPO_ROOT, mirrorDirRelative("plan"), target);
      const original = readFileSync(sandboxPath, "utf8");
      const realBytesBefore = readFileSync(realPath, "utf8");

      // BEFORE — the delta's first endpoint, over the SANDBOX copy. ⛔ Not asserted to be 0: the
      // AC's `links_broken === 0` claim about production is HAPPY (c)'s job. What this case owes is
      // that the corruption INCREASED it.
      const before = await measureLinksBrokenAt(root);
      expect(before.expected_files).toBeGreaterThan(0); // sanity floor: never a vacuous empty-dir delta

      const mutated = original.replace(/(links:\n  - \{id: )([^,]+)(, )/, `$1SPEC-999999$3`);
      expect(mutated).not.toBe(original); // sanity: the replace actually matched something

      writeFileSync(sandboxPath, mutated, "utf8");
      try {
        // AC-2(a) — byte-equality on the REAL counterpart of a rewrite.
        expect(readFileSync(realPath, "utf8"), `AC-2(a): the mutation escaped the sandbox and rewrote the REAL plan/${target}`).toBe(realBytesBefore);

        const after = await measureLinksBrokenAt(root);

        // DELTA: strictly more broken links than before, and the eval now fails.
        expect(after.links_broken).toBeGreaterThan(before.links_broken);
        expect(after.passed).toBe(false);
      } finally {
        writeFileSync(sandboxPath, original, "utf8");
        expect(readFileSync(sandboxPath, "utf8")).toBe(original);
      }
    },
    // Budget: ZERO `--check` passes (one pass costs 27.9s cold / 13.8s warm — see budgetMs).
    // TWO in-process migration-coverage passes (the delta's endpoints) over ~1741 sandbox files,
    // plus, on first use, the sandbox `cpSync` of ~13MB.
    budgetMs(0, 180_000),
  );
});

// ─── Pure: computeMirrorParity ──────────────────────────────────────────────

describe("computeMirrorParity (pure, no IO)", () => {
  const mkMapping = (filePath: string): ExportIndexMapping => ({ human_id: brandedHumanId("SPEC-1"), file_path: filePath });

  it("HAPPY: every spec mapped with its file present -> ok true, missing empty", () => {
    const specs = [{ id: "id-a", slug: "spec-a" }, { id: "id-b", slug: "spec-b" }];
    const mappings = { "id-a": mkMapping("docs/requirements/spec/a.md"), "id-b": mkMapping("docs/requirements/spec/b.md") };
    const result = computeMirrorParity(specs, mappings, () => true, 2);
    expect(result).toEqual({ corpusSpecCount: 2, fileCountOnDisk: 2, missing: [], ok: true });
  });

  it("NEGATIVE: a spec with no export-index entry at all is reported missing with reason no_mapping, naming its slug", () => {
    const specs = [{ id: "id-a", slug: "spec-never-exported" }];
    const result = computeMirrorParity(specs, {}, () => true, 0);
    expect(result.missing).toEqual([{ slug: "spec-never-exported", reason: "no_mapping" }]);
    expect(result.ok).toBe(false);
  });

  it("NEGATIVE: a spec mapped but whose file_path does not exist is reported missing with reason file_absent, naming its slug", () => {
    const specs = [{ id: "id-a", slug: "spec-deleted-file" }];
    const mappings = { "id-a": mkMapping("docs/requirements/spec/deleted.md") };
    const result = computeMirrorParity(specs, mappings, () => false, 0);
    expect(result.missing).toEqual([{ slug: "spec-deleted-file", reason: "file_absent" }]);
    expect(result.ok).toBe(false);
  });

  it("BOUNDARY: an orphan file inflating fileCountOnDisk beyond specs.length fails parity even though missing is empty", () => {
    const specs = [{ id: "id-a", slug: "spec-a" }];
    const mappings = { "id-a": mkMapping("docs/requirements/spec/a.md") };
    // fileExists is true for the one mapped file; fileCountOnDisk (2) reflects an orphan the
    // mapping table doesn't know about — the exact-count half of `ok` must catch this alone.
    const result = computeMirrorParity(specs, mappings, () => true, 2);
    expect(result.missing).toEqual([]);
    expect(result.fileCountOnDisk).toBe(2);
    expect(result.corpusSpecCount).toBe(1);
    expect(result.ok).toBe(false);
  });

  it("ERROR: an empty corpus against a non-empty on-disk count still fails parity (arithmetic is independent of missing, which is vacuously empty)", () => {
    const result = computeMirrorParity([], {}, () => true, 3);
    expect(result.missing).toEqual([]);
    expect(result.corpusSpecCount).toBe(0);
    expect(result.fileCountOnDisk).toBe(3);
    expect(result.ok).toBe(false);
  });

  it("STATE: multiple missing specs are ALL named, not just the first", () => {
    const specs = [
      { id: "id-a", slug: "spec-a-missing" },
      { id: "id-b", slug: "spec-b-present" },
      { id: "id-c", slug: "spec-c-missing" },
    ];
    const mappings = {
      "id-b": mkMapping("docs/requirements/spec/b.md"),
      "id-c": mkMapping("docs/requirements/spec/c.md"),
    };
    const fileExists = (p: string): boolean => p !== "docs/requirements/spec/c.md";
    const result = computeMirrorParity(specs, mappings, fileExists, 1);
    expect(result.missing).toEqual([
      { slug: "spec-a-missing", reason: "no_mapping" },
      { slug: "spec-c-missing", reason: "file_absent" },
    ]);
  });

  it("REGRESSION: fileExists is consulted with the mapping's file_path, never the spec's slug or id", () => {
    const specs = [{ id: "id-a", slug: "spec-a" }];
    const mappings = { "id-a": mkMapping("docs/requirements/spec/exact-path.md") };
    const seenArgs: string[] = [];
    const fileExists = (p: string): boolean => {
      seenArgs.push(p);
      return true;
    };
    computeMirrorParity(specs, mappings, fileExists, 1);
    expect(seenArgs).toEqual(["docs/requirements/spec/exact-path.md"]);
  });
});

// ─── Pure: scriptChainReachesTarget ──────────────────────────────────────────

describe("scriptChainReachesTarget (pure, no IO)", () => {
  it("HAPPY: a script's own value directly containing the target substring is reachable from itself", () => {
    const scripts = { "check:spec-mirror": "bun scripts/export-spec-mirror.ts --check" };
    expect(scriptChainReachesTarget(scripts, "check:spec-mirror", "export-spec-mirror.ts")).toBe(true);
  });

  it("HAPPY: one level of `bun run <name>` indirection to a script whose value contains the target is reachable", () => {
    const scripts = {
      test: "bun run test:vitest && bun run test:bun && bun run check:spec-mirror",
      "check:spec-mirror": "bun scripts/export-spec-mirror.ts --check",
    };
    expect(scriptChainReachesTarget(scripts, "test", "export-spec-mirror.ts")).toBe(true);
  });

  it("NEGATIVE (export-covers-corpus, RED a — in-memory control): a test chain with the check:spec-mirror reference removed does not reach the export script", () => {
    // Simulates exactly the AC-FR-6 RED(a) mutation ("remove the script from the chain") without
    // touching the real package.json — the mutated fixture mirrors the pre-fix `test` script
    // (before this task's own D6 revision wired check:spec-mirror into it).
    const mutatedScripts = {
      test: "bun run test:vitest && bun run test:bun",
      "check:spec-mirror": "bun scripts/export-spec-mirror.ts --check",
    };
    expect(scriptChainReachesTarget(mutatedScripts, "test", "export-spec-mirror.ts")).toBe(false);
  });

  it("BOUNDARY: a cyclic script chain (A -> B -> A) terminates and returns false when the target is unreachable", () => {
    const scripts = { a: "bun run b", b: "bun run a" };
    expect(scriptChainReachesTarget(scripts, "a", "export-spec-mirror.ts")).toBe(false);
  });

  it("ERROR: a rootScriptName absent from the scripts map returns false rather than throwing", () => {
    expect(() => scriptChainReachesTarget({}, "does-not-exist", "export-spec-mirror.ts")).not.toThrow();
    expect(scriptChainReachesTarget({}, "does-not-exist", "export-spec-mirror.ts")).toBe(false);
  });

  it("REGRESSION: a target existing as its OWN standalone, never-referenced script entry is NOT reachable from an unrelated root — existing is not the same as being wired (this repo's own prior check:* antipattern)", () => {
    const scripts = {
      test: "bun run test:vitest && bun run test:bun",
      "check:spec-mirror": "bun scripts/export-spec-mirror.ts --check",
    };
    expect(scriptChainReachesTarget(scripts, "test", "export-spec-mirror.ts")).toBe(false);
  });
});

// ─── export-covers-corpus: AC-FR-6 end-to-end ────────────────────────────────

describe("export-covers-corpus: AC-FR-6 end-to-end against the REAL package.json + REAL live corpus", () => {
  it("export-covers-corpus: HAPPY — the REAL root package.json's test chain reaches export-spec-mirror.ts (via check:spec-mirror), proving the export script is WIRED, not merely present", () => {
    // AC-FR-6 names the SCRIPT ("export-spec-mirror.ts"), never a specific mode-flag string —
    // `check:spec-mirror` invokes this exact file (with --check), so the criterion holds while
    // the chain-wired command itself stays read-only (D6; see export-spec-mirror.ts's own header
    // for why `mirror:export`, the WRITE mode, is deliberately NOT chain-wired).
    const scripts = readRealPackageScripts();
    expect(scriptChainReachesTarget(scripts, "test", "export-spec-mirror.ts")).toBe(true);
  });

  it(
    "export-covers-corpus: HAPPY — the read-only checker (AC-OX-1: never the write-mode exporter) reports on-disk file count EQUALS the LIVE corpus spec count and every corpus spec slug is present as a file",
    async () => {
      // The ONE real-tree `--check` pass this file spends (AC-OX-1: `--check`, never write mode).
      const checkResult = await runMirrorScriptOnRealTree();

      // ⛔ The exit code is NOT pinned to 0, and that is a strengthening, not a loosening.
      // `main`'s code is an AND across all six types AND the content probe, so pinning it to 0
      // would make this case assert corpus-wide, all-type cleanliness — which is (i) far wider
      // than AC-FR-6, whose subject is the SPEC mirror, and (ii) obtainable only in an exclusive
      // clean checkout, which the North Star names a refusal of the target state. Measured: a peer
      // session's `lore claim` re-drifts prd/task and this exits 2 while spec parity is perfect.
      // What IS asserted: the code is one the script DOCUMENTS (0 or MIRROR_DRIFT_EXIT_CODE) —
      // so a crash (MIRROR_HARD_FAILURE_EXIT_CODE) or a killed subprocess still fails here — plus
      // the spec-scoped OK line, which is the AC's actual subject.
      expect([0, MIRROR_DRIFT_EXIT_CODE]).toContain(checkResult.exitCode);
      expect(checkResult.stdout).toContain("OK — every corpus spec has a mirror file (count and slug parity; file CONTENT is not compared).");

      // Independent, fresh re-derivation — never trusts the script's own self-report.
      const { specs, mappings, fileCountOnDisk, fileExists } = measureParityAt(REPO_ROOT);
      expect(specs.length).toBeGreaterThan(0); // sanity floor: never a vacuous empty-corpus pass

      const parity = computeMirrorParity(specs, mappings, fileExists, fileCountOnDisk);
      expect(parity.missing).toEqual([]);
      expect(parity.fileCountOnDisk).toBe(parity.corpusSpecCount);
      expect(parity.ok).toBe(true);
    },
    // Budget: ONE `--check` pass (27.9s cold / 13.8s warm each) + one `lore list --type spec` read
    // (2,805,635 bytes measured). 1 x cold = 27.9s, +90s slack = 117.9s total.
    budgetMs(1, 90_000),
  );

  it(
    "export-covers-corpus: NEGATIVE (RED b, live) — deleting one exported file makes the parity check fail, NAMING that exact slug",
    () => {
      // ⛔ D2: the deletion lands in the mkdtemp SANDBOX. AC-FR-6's RED(b) is "delete one exported
      // file after export and the parity assertion must fail naming that slug" — a statement about
      // `computeMirrorParity`'s response to a missing file, which a copy of the real tree answers
      // exactly as the real tree would, without making a concurrent reader see a hole.
      const { root } = mirrorSandbox();

      const before = measureParityAt(root);
      const target = before.specs.find((s) => before.mappings[s.id] !== undefined);
      if (target === undefined) {
        throw new Error("test setup: no corpus spec has an export-index mapping in the sandbox index — cannot induce RED b");
      }
      const mapping = before.mappings[target.id]!;
      const sandboxPath = join(root, mapping.file_path);
      const realPath = join(REPO_ROOT, mapping.file_path);
      const original = readFileSync(sandboxPath, "utf8");

      // BEFORE endpoint — the target is NOT reported missing yet. ⛔ Deliberately not "the whole
      // mirror is clean": only that this slug is not already named, which is all the AFTER
      // assertion needs to attribute the change to this mutation.
      const parityBefore = computeMirrorParity(before.specs, before.mappings, before.fileExists, before.fileCountOnDisk);
      expect(parityBefore.missing).not.toContainEqual({ slug: target.slug, reason: "file_absent" });

      unlinkSync(sandboxPath);
      try {
        // AC-2(a) — goes RED the instant the mutation is pointed back at REPO_ROOT.
        expect(existsSync(realPath), `AC-2(a): the mutation escaped the sandbox and deleted the REAL ${mapping.file_path}`).toBe(true);

        // Re-measure fresh (never reuse the pre-deletion snapshot) so this assertion reflects
        // the SAME sandbox state the deletion just changed.
        const after = measureParityAt(root);
        const parityAfter = computeMirrorParity(after.specs, after.mappings, after.fileExists, after.fileCountOnDisk);

        expect(parityAfter.ok).toBe(false);
        expect(parityAfter.missing).toContainEqual({ slug: target.slug, reason: "file_absent" });

        // DELTA: named AFTER, not named BEFORE.
        const newlyMissing = parityAfter.missing.filter(
          (m) => !parityBefore.missing.some((b) => b.slug === m.slug && b.reason === m.reason),
        );
        expect(newlyMissing).toEqual([{ slug: target.slug, reason: "file_absent" }]);
      } finally {
        writeFileSync(sandboxPath, original, "utf8");
        expect(readFileSync(sandboxPath, "utf8")).toBe(original);
      }
    },
    // Budget: ZERO `--check` passes (one pass costs 27.9s cold / 13.8s warm — see budgetMs). Two
    // `lore list --type spec` reads (the delta's endpoints) plus, on first use, the sandbox
    // `cpSync` of ~13MB / 1741 files.
    budgetMs(0, 120_000),
  );
});

/**
 * Runs ONE read-only `--check` pass against the REAL repo root, exactly as `bun run
 * check:spec-mirror` does (⛔ AC-OX-1: `--check`, never the bare write-mode invocation). Only
 * `export-covers-corpus`'s parity case calls this — every MUTATION case uses
 * {@link runSandboxCheck} instead.
 */
async function runMirrorScriptOnRealTree(): Promise<CheckResult> {
  const { stdout, stderr, exitCode } = await spawnCaptureAsync(
    "export-spec-mirror --check (real tree)",
    "bun",
    ["run", join(REPO_ROOT, "scripts", "export-spec-mirror.ts"), "--check"],
  );
  return { stdout, stderr, exitCode, output: `${stdout}\n${stderr}` };
}

// ─── drift-check-is-separate: AC-FR-7 end-to-end ─────────────────────────────

describe("drift-check-is-separate: AC-FR-7 end-to-end against the REAL script + REAL live corpus", () => {
  it(
    "drift-check-is-separate: HAPPY — running --check twice in a row over unchanged state reports the IDENTICAL verdict both times and regenerates nothing",
    async () => {
      // ⛔ AC-FR-7's own words are "run twice in a row it reports the same drift both times" —
      // IDENTITY, not "reports OK". The pre-fix revision asserted OK, which (i) needed a third
      // `--check` pass as a clean-baseline precondition and (ii) could not pass at all whenever
      // the shared corpus was drifted, i.e. it tested exclusivity rather than idempotence.
      const { root } = mirrorSandbox();

      const manifestBefore = hashManifest(root);
      const first = await sandboxCheckBaseline();
      const manifestBetween = hashManifest(root);
      const second = await runSandboxCheck();
      const manifestAfter = hashManifest(root);

      // THE no-repair proof, and the one assertion no concurrent corpus write can move: a
      // byte-level measurement of the very tree the check inspected, sampled before, between, and
      // after the two runs. A check that regenerated ANY mirror file fails here.
      expect(manifestBetween).toBe(manifestBefore);
      expect(manifestAfter).toBe(manifestBefore);

      // "Reports the same drift both times", asserted on the projection the frozen tree alone
      // determines — see onDiskFileCountProjection for why the corpus-derived lines are excluded
      // rather than compared (comparing them was measured to flake on a peer's doc creation).
      // A repair would necessarily move these counts.
      const firstCounts = onDiskFileCountProjection(first.output);
      expect(onDiskFileCountProjection(second.output)).toEqual(firstCounts);

      // Sanity floor: never a vacuous pass. An empty report, or a projection that matched nothing,
      // would satisfy the identity assertion above trivially — so require one count line per
      // mirrored type, which is also proof the regex still matches the report's real shape.
      expect(firstCounts).toHaveLength(MIRROR_TYPES.length);
      expect(first.output).toContain("export-spec-mirror (check):");

      // Both runs must have produced a verdict the script DOCUMENTS — so a crash
      // (MIRROR_HARD_FAILURE_EXIT_CODE) or a killed subprocess still fails here. ⛔ Not asserted
      // EQUAL to each other: on a corpus a peer is writing to, run 2 can legitimately see drift
      // run 1 did not, and that is the corpus moving, not the check repairing. The manifest
      // assertions above are what carry "it repaired nothing".
      expect([0, MIRROR_DRIFT_EXIT_CODE]).toContain(first.exitCode);
      expect([0, MIRROR_DRIFT_EXIT_CODE]).toContain(second.exitCode);
    },
    // Budget: TWO `--check` passes (27.9s cold / 13.8s warm each) — the memoized shared baseline
    // plus one more consecutive run. 2 x cold = 55.8s, +120s slack = 175.8s, in line with the repo
    // precedent for this shape (`mirror-status-parity.test.ts` 180_000,
    // `spec-mirror-content-drift.test.ts` 120_000).
    budgetMs(2, 120_000),
  );

  it(
    "drift-check-is-separate: NEGATIVE — with one mirror file deleted, --check exits EXACTLY MIRROR_DRIFT_EXIT_CODE and names the missing slug on BOTH consecutive runs, never regenerating the file",
    async () => {
      // ⛔ D2: the deletion lands in the mkdtemp SANDBOX, so the real `docs/requirements/spec/`
      // file the concurrently-scheduled `mirror-status-parity.test.ts` walks is never absent.
      const { root } = mirrorSandbox();

      const before = measureParityAt(root);
      const target = before.specs.find((s) => before.mappings[s.id] !== undefined);
      if (target === undefined) {
        throw new Error("test setup: no corpus spec has an export-index mapping in the sandbox index — cannot induce this scenario");
      }
      const mapping = before.mappings[target.id]!;
      const sandboxPath = join(root, mapping.file_path);
      const realPath = join(REPO_ROOT, mapping.file_path);
      const original = readFileSync(sandboxPath, "utf8");

      // BEFORE endpoint — the shared memoized baseline. ⛔ Its exit code is NOT asserted to be 0:
      // on a drifted shared corpus it is legitimately MIRROR_DRIFT_EXIT_CODE already, which is
      // precisely why "exits EXACTLY 2 after the mutation" cannot by itself carry this case. The
      // DISCRIMINATOR is the slug delta below: this slug is named AFTER and was NOT named BEFORE.
      const baseline = await sandboxCheckBaseline();
      expect(baseline.output).not.toContain(target.slug);

      unlinkSync(sandboxPath);
      try {
        // AC-2(a) — goes RED the instant the mutation is pointed back at REPO_ROOT.
        expect(existsSync(realPath), `AC-2(a): the mutation escaped the sandbox and deleted the REAL ${mapping.file_path}`).toBe(true);

        const firstCheck = await runSandboxCheck();
        expect(firstCheck.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
        expect(firstCheck.output).toContain(target.slug);

        // The check must NEVER regenerate what it inspects — the file must still be absent,
        // and a SECOND consecutive run must report the IDENTICAL drift, not a self-healed clean.
        expect(existsSync(sandboxPath)).toBe(false);

        const secondCheck = await runSandboxCheck();
        expect(secondCheck.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
        expect(secondCheck.output).toContain(target.slug);
        expect(existsSync(sandboxPath)).toBe(false);

        // "reports the same drift both times", on the same projection rationale as the HAPPY case
        // above: the on-disk counts are what a repair would move, and they are immune to the peer
        // corpus writes that made a full-report comparison flake.
        expect(onDiskFileCountProjection(secondCheck.output)).toEqual(onDiskFileCountProjection(firstCheck.output));

        // DELTA — the assertion that actually discriminates: the slug appears only AFTER the
        // deletion. A check that repaired the file, or one that was already reporting this slug,
        // fails here.
        expect(baseline.output).not.toContain(target.slug);
        expect(firstCheck.output).toContain(`${target.slug} — mapped file missing on disk`);
      } finally {
        writeFileSync(sandboxPath, original, "utf8");
        expect(readFileSync(sandboxPath, "utf8")).toBe(original);
      }
    },
    // Budget: THREE `--check` passes worst case (27.9s cold / 13.8s warm each) — the shared
    // baseline (free when the HAPPY case above already ran it, paid in full when this case is
    // filtered to on its own) plus the two post-mutation runs AC-FR-7 requires. 3 x cold = 83.7s,
    // +90s slack = 173.7s.
    budgetMs(3, 90_000),
  );
});
