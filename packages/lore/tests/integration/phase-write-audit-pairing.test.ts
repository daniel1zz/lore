// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/ac-service.ts
// @reads packages/lore/src/service/phase-service.ts
// @reads packages/lore/src/service/requirement-service.ts
// @reads packages/lore/src/service/task-workflow-service.ts
// @reads packages/lore/src/store/sqlite-store.ts
/**
 * Phase-write audit-pairing oracle — the SINGLE file behind SPEC-148's
 * AC-PHASEVER-4 (`spec-lore-phase-add-and-phase-rm-mutate-a-plan-s-declared`).
 *
 * @spec_ref AC-PHASEVER-4
 *
 * ## What is being pinned
 *
 * `adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan` (accepted
 * 2026-08-24) decides that phase writes SHALL log a version row. A version row
 * is only half of a provenance record: `AuditService.verify` reconciles every
 * `action:"update"` versions row against an audit entry joined on
 * `(doc_id, details.version)`, so a version row written WITHOUT its paired
 * audit entry is an unexplained row — `lore audit --verify` reports it in
 * `misses[]`, returns `clean: false` and exits 4.
 *
 * This file asserts the pairing HOLDS for all three phase writers, through the
 * CLI, against a real corpus.
 *
 * ## Why this file exists at all (SPEC-148 C5) — the failure it closes
 *
 * The shape SPEC-148's own dispatch bundle originally prescribed — a bare
 * `store.insertVersion` beside a bare `store.update` — severs that pairing and
 * makes `lore audit --verify` report one miss per phase write. The sibling
 * parity suite (`phase-write-lifecycle-doc-parity.test.ts`) passed 41/41,
 * exit 0, AGAINST that severed shape, because it contains zero
 * `audit --verify` assertions. AC-PHASEVER-1/2/3 therefore had no
 * discriminating power over a broken audit trail.
 *
 * ⛔ So this file's own green is worth nothing unless it can be shown to go
 * red. Measured in this worktree while authoring it (recorded on the task as
 * `--result expected-fail`): with `writePhases`' single
 * `store.updateWithProvenance` call replaced by `store.update` +
 * `store.insertVersion`, this suite fails with `clean: false`, `misses.length`
 * 3 (one per phase write) and `audit --verify` exit 4. The correct
 * implementation was restored immediately afterwards; the probe is not in the
 * tree.
 *
 * That probe is a one-time measurement and does not ship, so the discriminating
 * power is ALSO built into the suite as two synthetic tamper controls that run
 * on every invocation (see "Green controls" below).
 *
 * ## Reader — pinned to `--json`
 *
 * ⛔ `lore audit --verify --json` only. The printed line
 * `Chain integrity: clean (N entries checked).` is REFUSED as a reader:
 * AC-PHASEVER-1(b) already rejected printed output for exactly this reason and
 * pinned a JSON field instead, and an earlier draft of AC-PHASEVER-4 was
 * corrected for the same inconsistency. Fields read here, all measured
 * 2026-08-24/25 to exist: `data.clean`, `data.misses`, `data.chain.clean`,
 * `data.chain.checked`, `data.anchor.status`, `data.since`.
 *
 * ⛔ `audit --verify` sets `process.exitCode = clean ? 0 : 4` and prints the
 * JSON envelope in BOTH cases, so `readAuditVerify` accepts exactly those two
 * exit codes and throws on any other. A reader that treated 4 as a crash would
 * turn the two tamper controls below into unreadable errors instead of
 * measurements.
 *
 * ## Invocation shape — pinned by the spec, not chosen here
 *
 * - The CLI is reached through THIS WORKTREE'S OWN SOURCE
 *   (`<repo>/packages/lore/src/index.ts`), never a prebuilt `dist/lore`: that
 *   binary is whatever commit last ran `bun run build`, so a suite spawning it
 *   measures a DIFFERENT commit while reporting the verdict as this change's.
 *   `assertEntryUnderTest()` REFUSES the mistake on EVERY spawn rather than
 *   merely avoiding it.
 * - vitest is the pinned runner, so nothing here may top-level-import
 *   `bun:sqlite` or anything that transitively does. That is what forces the
 *   subprocess shape instead of an in-process `createApp`, and it is also why
 *   the orphan-row control below reaches `SQLiteStore` through a generated
 *   script run by `bun`, never by importing it.
 * - Every write goes to a `mkdtemp` + `lore init` throwaway corpus with `HOME`
 *   redirected inside it. `runLoreInFixture` refuses any cwd that is not a
 *   fixture THIS FILE created, and this suite never reads or writes the repo's
 *   own `.lore/` at all — the only repo paths it touches are two source files
 *   it reads for the structural regression guard.
 *
 * ## Green controls — the audit reader must be shown to discriminate
 *
 * `clean === true` and `misses.length === 0` are both satisfied by a reader
 * that is simply stuck on "clean". Two independent tampers, each in its OWN
 * throwaway corpus, prove otherwise in the same run:
 *
 *   1. ANCHOR tamper (pure filesystem): an `.lore/audit-anchor.json` naming a
 *      `head_id` no chain row carries → `anchor.status: "anchor_mismatch"`,
 *      `clean: false`, exit 4 — while `misses` stays 0 and `chain.clean` stays
 *      true. Proves the `clean` verdict and the exit code discriminate. The
 *      same corpus is re-verified after the file is deleted and must return to
 *      clean/exit 0, so the tamper — not a poisoned fixture — is the cause.
 *   2. ORPHAN VERSION ROW: one `action:"update"` versions row inserted directly
 *      through `SQLiteStore` with no paired audit entry → `misses.length` 1
 *      naming that exact `(doc_id, version)`, `clean: false`, exit 4 — while
 *      `chain.clean` stays true. This is the ONE control that exercises the
 *      completeness join itself, i.e. the exact reader the severed
 *      implementation trips. Control 1 cannot substitute for it: an anchor
 *      mismatch leaves `misses` empty.
 *
 * A third, cheaper non-vacuity guard covers the case where the join has no
 * candidates at all: `data.since` (the reconcile watermark, resolved from
 * config) is asserted to precede the fixture's own version rows. If that
 * watermark ever drifted past them, every `misses.length === 0` here would be
 * vacuously true and no tamper except an anchor mismatch would be visible.
 *
 * ## Two phrases this file must never spell out
 *
 * AC-PHASEVER-3(d) pins a repo-wide `grep -rIl -e … -e … packages/` == 0 files
 * with no `--exclude` and no path filter. This file lives under `packages/`, so
 * spelling either phrase out would match that grep and make the criterion
 * unreachable no matter what the implementation did. Both are therefore
 * assembled by CONCATENATION below and never written contiguously anywhere in
 * this file — prose included. `guards its own source against the phrases
 * AC-PHASEVER-3(d) bans` fails loud if a future edit joins them back up.
 *
 * ## Six-dimension coverage
 *
 *   HAPPY:      `phase add` / `rename` / `rm` each exit 0 and leave
 *               `audit --verify` clean, exit 0, `misses` empty, chain clean
 *   NEGATIVE:   the two tamper controls (anchor mismatch, orphan version row)
 *               must each produce `clean: false` + exit 4; `phase-service.ts`
 *               must contain NO bare `insertVersion`; and the out-of-tree
 *               severed-implementation probe recorded on the task
 *   BOUNDARY:   `chain.checked` STRICTLY increases across the three writes AND
 *               moves by EXACTLY 1 per write (never ">= 1"); the reconcile
 *               watermark provably precedes the fixture's version rows
 *   ERROR:      exit codes asserted with `toBe(0)` / `toBe(4)`, never
 *               "non-zero"; every reader throws NAMING the raw output on an
 *               unparseable or unexpected envelope; `runLoreInFixture` refuses
 *               a cwd it did not create; `assertEntryUnderTest` refuses a
 *               prebuilt binary
 *   STATE:      `lore phase list` is read back INDEPENDENTLY after each write,
 *               so "the audit trail is clean" can never be confused with
 *               "the write silently did nothing"
 *   REGRESSION: the structural guard that `writePhases` still routes through
 *               the atomic `updateWithProvenance` writer, with `ac-service.ts`
 *               as the nonzero control for the grep that must read 0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Locations ──────────────────────────────────────────────────────────────

/** Repo root — four levels up from `packages/lore/tests/integration/`. Re-asserted on every spawn. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");

/** The CLI entry under test: this worktree's own SOURCE. ⛔ Never `dist/lore` — see the header. */
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

const PHASE_SERVICE_PATH = join(REPO_ROOT, "packages", "lore", "src", "service", "phase-service.ts");
const AC_SERVICE_PATH = join(REPO_ROOT, "packages", "lore", "src", "service", "ac-service.ts");

/**
 * The CONTROL for the "zero bare version writes" assertion. It used to read a store-only service that still wrote its
 * version row bare (`ac-service.ts`, then `requirement-service.ts`, then `task-workflow-service.ts`). After
 * spec-no-module-writes-around-the-write-path (AC-DCL-5) NO module outside `corpus-service.ts` and `store/*` writes
 * one, so there is no file left to aim the control at; it now proves the pattern against a sample of the exact
 * call shape instead (the repo-wide zero is pinned by `write-path-everywhere.bun.test.ts`).
 */
const BARE_WRITER_CONTROL_SAMPLE = "const written = await this.store.insertVersion(versionRecord);";

/** Reached ONLY by the generated tamper script below, never imported — it pulls in `bun:sqlite`. */
const SQLITE_STORE_PATH = join(REPO_ROOT, "packages", "lore", "src", "store", "sqlite-store.ts");

/** This file's own path — read back by the self-guard protecting the split literals below. */
const SELF_PATH = fileURLToPath(import.meta.url);

/** Actor for fixture writes. Fixture corpora only — this suite never addresses the live corpus. */
const ACTOR = "test:phase-write-audit-pairing";

// ─── Literals ───────────────────────────────────────────────────────────────

/**
 * The two phrases AC-PHASEVER-3(d) bans from every file under `packages/`.
 *
 * ⛔ Assembled by CONCATENATION and never written contiguously anywhere in this
 * file — see the header section "Two phrases this file must never spell out".
 * Splitting here is what lets that criterion keep its pinned match rule with no
 * `--exclude` and no path filter while this suite lives under `packages/`.
 */
const BANNED_PHRASE_A = "no version" + " history";
const BANNED_PHRASE_B = "version" + "-less";

/**
 * The atomic doc+version+audit writer `writePhases` must keep using (SPEC-148 C5): since defect-clusters D3 that is the
 * one write route, `CorpusService.writeDoc`, which commits all three in one `updateWithProvenance` transaction.
 *
 * ⛔ Anchored to the CALL SITE (`this.store.` prefix + open paren), never the
 * bare identifier. MEASURED while authoring this file: the bare identifier
 * `insertVersion` occurs once in `phase-service.ts` inside the very comment
 * explaining why the composite writer is used instead — so the bare-substring
 * form of the guard below reported the severed shape against a correct
 * implementation. A self-documenting file is exactly where a marker census
 * over-matches.
 */
const ATOMIC_WRITER_CALL = "this.writer.writeDoc(";

/**
 * The bare version write whose presence in `phase-service.ts` IS the severed
 * shape. `ac-service.ts` is its nonzero control — that file legitimately makes
 * this call, so a 0 here cannot be a mis-aimed grep.
 */
const BARE_VERSION_WRITE_CALL = "this.store.insertVersion(";

// ─── Primitives ─────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Occurrences of a FIXED string. Refuses an empty needle — that would silently return a length. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) throw new Error("refusing to count occurrences of an empty needle");
  return haystack.split(needle).length - 1;
}

/**
 * ⛔ The refusal the spec's invocation-shape clause demands. Runs on EVERY
 * spawn, so "we used the source, honest" is never taken on trust: the resolved
 * entry must exist, must be `<repo under test>/packages/lore/src/index.ts`, and
 * must not be a compiled artefact.
 */
function assertEntryUnderTest(): void {
  const requiredSuffix = join("packages", "lore", "src", "index.ts");
  if (!LORE_ENTRY.startsWith(REPO_ROOT + sep)) {
    throw new Error(`CLI entry ${LORE_ENTRY} is not inside the repo under test (${REPO_ROOT})`);
  }
  if (!LORE_ENTRY.endsWith(requiredSuffix)) {
    throw new Error(`CLI entry ${LORE_ENTRY} does not end with ${requiredSuffix} — refusing to measure a different surface`);
  }
  if (LORE_ENTRY.includes(`${sep}dist${sep}`) || basename(LORE_ENTRY) === "lore") {
    throw new Error(`CLI entry ${LORE_ENTRY} looks like a prebuilt binary — that measures whatever commit last ran \`bun run build\``);
  }
  if (!existsSync(LORE_ENTRY)) throw new Error(`CLI entry ${LORE_ENTRY} does not exist`);
  for (const proof of [PHASE_SERVICE_PATH, AC_SERVICE_PATH, SQLITE_STORE_PATH]) {
    if (!existsSync(proof)) throw new Error(`${REPO_ROOT} is not the repo under test — ${proof} is missing`);
  }
}

/** Fixture directories this file created. Nothing outside this list is ever a write target. */
const fixtureDirs: string[] = [];

function spawnLore(args: readonly string[], cwd: string): RunResult {
  assertEntryUnderTest();
  const proc = spawnSync("bun", [LORE_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      // HOME is redirected into the fixture so no global lore state on the
      // machine is read or written.
      HOME: cwd,
      EDITOR: "true",
      // reason: SPEC-024 — AI is OFF for agent surfaces. Pinned explicitly rather
      // than inherited so a developer shell without CLAUDECODE=1 cannot make this
      // suite nest a Claude call inside `lore create`/`lore review`.
      CI: "true",
      LORE_AI_DEFAULT: "off",
      LORE_ACTOR: ACTOR,
    },
  });
  if (proc.status === null) {
    throw new Error(`lore ${args.join(" ")} was killed by signal ${String(proc.signal)} — no exit code to assert`);
  }
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", exitCode: proc.status };
}

/** Runs any verb against a throwaway corpus THIS FILE created. Refuses every other cwd. */
function runLoreInFixture(args: readonly string[], dir: string): RunResult {
  if (!fixtureDirs.includes(dir)) {
    throw new Error(`refusing to run \`lore ${args.join(" ")}\` in ${dir} — not a fixture this file created`);
  }
  return spawnLore(args, dir);
}

/** Strict envelope parse — a non-JSON or failing `--json` run throws NAMING the raw output, never yields a default. */
function jsonEnvelope<T>(run: RunResult, label: string): T {
  if (run.exitCode !== 0) {
    throw new Error(`${label} exited ${run.exitCode}: ${run.stderr.trim() || run.stdout.trim()}`);
  }
  return parseEnvelope<T>(run.stdout, label);
}

function parseEnvelope<T>(stdout: string, label: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (cause) {
    throw new Error(`${label} did not emit a JSON envelope: ${JSON.stringify(stdout.slice(0, 400))}`, { cause });
  }
  const envelope = parsed as { ok?: boolean; data?: T };
  if (envelope.ok !== true || envelope.data === undefined) {
    throw new Error(`${label} returned a non-ok envelope: ${JSON.stringify(parsed).slice(0, 400)}`);
  }
  return envelope.data;
}

// ─── The pinned reader: `lore audit --verify --json` ────────────────────────

interface AuditMissRow {
  readonly doc_id: string;
  readonly version: number;
  readonly action: string;
  readonly created_at: string;
}

interface AuditVerifyData {
  readonly clean: boolean;
  readonly misses: readonly AuditMissRow[];
  readonly since: string;
  readonly chain: { readonly clean: boolean; readonly checked: number };
  readonly anchor: { readonly status: string; readonly reason?: string };
}

interface AuditVerifyReading extends AuditVerifyData {
  readonly exitCode: number;
}

/**
 * ⛔ The ONLY reader of the verdict, and it is pinned to `--json` (see header).
 *
 * Accepts exit 0 and exit 4 — the command's two legitimate verdicts — and
 * throws on anything else, so a crash can never be silently read as "dirty".
 * Every field the criterion names is shape-checked here rather than trusted, so
 * a renamed or dropped field fails loud instead of arriving as `undefined` and
 * making a `toBe(0)` on `misses.length` throw something uninformative.
 */
function readAuditVerify(dir: string): AuditVerifyReading {
  const run = runLoreInFixture(["audit", "--verify", "--json"], dir);
  const label = "lore audit --verify --json";
  if (run.exitCode !== 0 && run.exitCode !== 4) {
    throw new Error(`${label} exited ${run.exitCode} (expected 0 = clean or 4 = not clean): ${run.stderr.trim() || run.stdout.trim()}`);
  }
  const data = parseEnvelope<AuditVerifyData>(run.stdout, label);
  if (typeof data.clean !== "boolean") throw new Error(`${label} carries no boolean data.clean`);
  if (!Array.isArray(data.misses)) throw new Error(`${label} carries no data.misses array`);
  if (typeof data.since !== "string") throw new Error(`${label} carries no string data.since`);
  if (typeof data.chain?.clean !== "boolean") throw new Error(`${label} carries no boolean data.chain.clean`);
  if (typeof data.chain?.checked !== "number") throw new Error(`${label} carries no numeric data.chain.checked`);
  if (typeof data.anchor?.status !== "string") throw new Error(`${label} carries no string data.anchor.status`);
  return { ...data, exitCode: run.exitCode };
}

// ─── Fixture-corpus readers ─────────────────────────────────────────────────

/**
 * The declared phase names, read back INDEPENDENTLY of the write command's own
 * output. STATE non-vacuity guard: without it, "the audit trail stayed clean"
 * is indistinguishable from "the write silently did nothing".
 */
function phaseNames(dir: string, slug: string): readonly string[] {
  const data = jsonEnvelope<{ phases: ReadonlyArray<{ name: string }> }>(
    runLoreInFixture(["phase", "list", slug, "--json"], dir),
    `lore phase list ${slug} --json`,
  );
  return data.phases.map((p) => p.name);
}

/** The plan's ULID and the `created_at` of its EARLIEST version row — the watermark guard's reference point. */
function planIdAndEarliestVersionAt(dir: string, slug: string): { readonly docId: string; readonly earliestAt: string } {
  const doc = jsonEnvelope<{ doc: { id: string } }>(
    runLoreInFixture(["get", slug, "--json"], dir),
    `lore get ${slug} --json`,
  );
  const log = jsonEnvelope<{ entries: ReadonlyArray<{ created_at: string }>; total: number }>(
    runLoreInFixture(["log", slug, "--json"], dir),
    `lore log ${slug} --json`,
  );
  if (log.entries.length !== log.total) {
    throw new Error(`lore log ${slug} --json is truncated: ${log.entries.length} entries vs data.total ${log.total}`);
  }
  if (log.entries.length === 0) throw new Error(`lore log ${slug} --json returned no version rows — nothing to anchor the watermark guard to`);
  const earliestAt = log.entries.map((e) => e.created_at).sort()[0] as string;
  return { docId: doc.doc.id, earliestAt };
}

/** `mkdtemp` + `lore init` + an APPROVED plan. Setup steps throw loudly; only the writes under test get `expect`ed exit codes. */
function makeApprovedPlan(title: string): { readonly dir: string; readonly slug: string } {
  const dir = mkdtempSync(join(tmpdir(), "lore-phase-audit-pairing-"));
  fixtureDirs.push(dir);

  const init = spawnLore(["init", "--author", "phase-audit-pairing-oracle"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed (exit ${init.exitCode}): ${init.stderr}`);
  if (!existsSync(join(dir, ".lore", "lore.db"))) {
    throw new Error(`lore init did not create ${join(dir, ".lore", "lore.db")} — a later verb would walk up to a foreign corpus`);
  }

  // reason: plans are judged by default (BR-281 / BR-1237), and this suite's `lore review` step yields no
  // approving judgment; the plan is approved only to put it in a lifecycle state, never to test review-judgment.
  appendFileSync(join(dir, ".lore", "config.yaml"), "workflow:\n  review:\n    judgment_required_types: []\n", "utf8");

  const created = jsonEnvelope<{ slug: string }>(
    runLoreInFixture(["create", "plan", "--title", title, "--content", "Baseline content.", "--json"], dir),
    "lore create plan --json",
  );
  jsonEnvelope<unknown>(runLoreInFixture(["review", created.slug, "--json"], dir), `lore review ${created.slug} --json`);
  const approved = jsonEnvelope<{ status: string }>(
    runLoreInFixture(["approve", created.slug, "--json"], dir),
    `lore approve ${created.slug} --json`,
  );
  if (approved.status !== "approved") {
    throw new Error(`fixture plan ${created.slug} is "${approved.status}", not "approved" — the premise of every assertion below`);
  }
  return { dir, slug: created.slug };
}

// ─── Tamper control 2: an orphan version row, written through `SQLiteStore` ──

/** The synthetic version number the orphan row is inserted at — far above any real version, so the `(doc_id, version)` PK cannot collide. */
const ORPHAN_VERSION = 9001;

/**
 * Inserts ONE `action:"update"` versions row with no paired audit entry, so
 * `AuditService.verify`'s completeness join has exactly one unexplained row to
 * report. This is the control that proves `misses.length === 0` above is a
 * measurement and not a constant.
 *
 * ⛔ Reached through a GENERATED script run by `bun`, never by importing
 * `SQLiteStore` here: it pulls in `bun:sqlite`, which vitest cannot load (see
 * the root CLAUDE.md's runner split). The script is written into the fixture
 * directory, so it is removed with the fixture and never lands under
 * `packages/`.
 *
 * Going through `SQLiteStore.insertVersion` rather than hand-written SQL keeps
 * the control coupled to the store CONTRACT instead of to the `versions` table
 * layout — a schema change moves both together, and a contract change fails
 * loud here rather than silently inserting nothing.
 */
function insertOrphanVersionRow(dir: string, docId: string): void {
  const script = [
    `const { SQLiteStore } = await import(${JSON.stringify(SQLITE_STORE_PATH)});`,
    `const store = new SQLiteStore(${JSON.stringify(join(dir, ".lore", "lore.db"))});`,
    `const result = await store.insertVersion({`,
    `  doc_id: ${JSON.stringify(docId)},`,
    `  version: ${ORPHAN_VERSION},`,
    `  content: "synthetic orphan row — audit-pairing control",`,
    `  extra: {},`,
    `  status: "approved",`,
    `  title: "synthetic orphan row",`,
    `  action: "update",`,
    `  created_at: new Date().toISOString(),`,
    `  created_by: ${JSON.stringify(ACTOR)},`,
    `  change_summary: "synthetic version row deliberately written with no paired audit entry",`,
    `});`,
    `if (!result.ok) { console.error("insertVersion failed: " + JSON.stringify(result.error)); process.exit(1); }`,
    `console.log("orphan-version-row-inserted");`,
  ].join("\n");

  const scriptPath = join(dir, "insert-orphan-version-row.ts");
  writeFileSync(scriptPath, `${script}\n`, "utf8");

  const proc = spawnSync("bun", [scriptPath], { cwd: dir, encoding: "utf8", env: { ...process.env, HOME: dir } });
  if (proc.status !== 0) {
    throw new Error(`orphan-row control failed (exit ${String(proc.status)}): ${proc.stderr ?? ""}${proc.stdout ?? ""}`);
  }
  if (!(proc.stdout ?? "").includes("orphan-version-row-inserted")) {
    throw new Error(`orphan-row control exited 0 without confirming the insert — refusing to treat a no-op as a control: ${proc.stdout ?? ""}`);
  }
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

afterAll(() => {
  const base = tmpdir();
  for (const dir of fixtureDirs) {
    if (dir === "" || !dir.startsWith(base)) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Invocation-shape and corpus-safety guards
// ────────────────────────────────────────────────────────────────────────────

describe("invocation shape and corpus safety guards", () => {
  it("resolves its CLI entry to this repo's own source, never a prebuilt binary", () => {
    expect(() => assertEntryUnderTest()).not.toThrow();
  });

  it("resolves that entry to the source file, not a dist artefact", () => {
    expect(LORE_ENTRY).toBe(join(REPO_ROOT, "packages", "lore", "src", "index.ts"));
  });

  it("refuses a fixture run against any cwd it did not create", () => {
    expect(() => runLoreInFixture(["audit", "--verify", "--json"], REPO_ROOT)).toThrow(
      /not a fixture this file created/,
    );
  });

  it("guards its own source against the phrases spec-lore-phase-add-and-phase-rm-mutate-a-plan-s-declared#AC-PHASEVER-3(d) bans from packages/", () => {
    const self = readFileSync(SELF_PATH, "utf8");
    expect(countOccurrences(self, BANNED_PHRASE_A), `${SELF_PATH} spells out a banned phrase contiguously`).toBe(0);
    expect(countOccurrences(self, BANNED_PHRASE_B), `${SELF_PATH} spells out a banned phrase contiguously`).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC-PHASEVER-4 — the pairing holds across all three phase writers
// ────────────────────────────────────────────────────────────────────────────

interface WriteStep {
  readonly label: string;
  readonly exitCode: number;
  readonly phasesAfter: readonly string[];
  readonly verify: AuditVerifyReading;
}

describe("AC-PHASEVER-4 — lore audit --verify stays clean across phase add, rename and rm", () => {
  let baseline: AuditVerifyReading;
  let steps: readonly WriteStep[];
  let earliestVersionAt: string;

  beforeAll(() => {
    const { dir, slug } = makeApprovedPlan("Phase audit pairing approved plan");
    earliestVersionAt = planIdAndEarliestVersionAt(dir, slug).earliestAt;
    baseline = readAuditVerify(dir);

    const collected: WriteStep[] = [];
    const writes: ReadonlyArray<{ label: string; args: readonly string[] }> = [
      { label: "lore phase add", args: ["phase", "add", slug, "P1", "--json"] },
      { label: "lore phase rename", args: ["phase", "rename", slug, "P1", "P1x", "--json"] },
      { label: "lore phase rm", args: ["phase", "rm", slug, "P1x", "--json"] },
    ];
    for (const write of writes) {
      const run = runLoreInFixture(write.args, dir);
      collected.push({
        label: write.label,
        exitCode: run.exitCode,
        phasesAfter: phaseNames(dir, slug),
        verify: readAuditVerify(dir),
      });
    }
    steps = collected;
  }, 180_000);

  // ── HAPPY — the writes themselves ──

  it("each phase write exits 0", () => {
    expect(steps.map((s) => `${s.label}:${s.exitCode}`)).toEqual([
      "lore phase add:0",
      "lore phase rename:0",
      "lore phase rm:0",
    ]);
  });

  // ── STATE non-vacuity — the writes really happened ──

  it("STATE non-vacuity: each write actually changed phases[], read back independently", () => {
    expect(steps.map((s) => s.phasesAfter)).toEqual([["P1"], ["P1x"], []]);
  });

  // ── The four assertions AC-PHASEVER-4 pins ──

  it("`lore audit --verify` exits 0 after each of add, rename and rm", () => {
    expect(steps.map((s) => `${s.label}:${s.verify.exitCode}`)).toEqual([
      "lore phase add:0",
      "lore phase rename:0",
      "lore phase rm:0",
    ]);
  });

  it("data.clean is true after each of add, rename and rm", () => {
    expect(steps.map((s) => `${s.label}:${String(s.verify.clean)}`)).toEqual([
      "lore phase add:true",
      "lore phase rename:true",
      "lore phase rm:true",
    ]);
  });

  it("data.misses is empty after each of add, rename and rm", () => {
    expect(steps.map((s) => `${s.label}:${JSON.stringify(s.verify.misses)}`)).toEqual([
      "lore phase add:[]",
      "lore phase rename:[]",
      "lore phase rm:[]",
    ]);
  });

  it("data.chain.clean is true after each of add, rename and rm", () => {
    expect(steps.map((s) => `${s.label}:${String(s.verify.chain.clean)}`)).toEqual([
      "lore phase add:true",
      "lore phase rename:true",
      "lore phase rm:true",
    ]);
  });

  // ── BOUNDARY — the non-vacuity guard the criterion requires ──

  it("BOUNDARY non-vacuity: data.chain.checked STRICTLY increases across the three writes", () => {
    const observed = [baseline.chain.checked, ...steps.map((s) => s.verify.chain.checked)];
    for (let i = 1; i < observed.length; i++) {
      expect(
        observed[i] as number,
        `chain.checked did not increase at step ${i} — sequence ${JSON.stringify(observed)}; a clean verdict over an unmoved count has not observed the phase writes`,
      ).toBeGreaterThan(observed[i - 1] as number);
    }
  });

  it("BOUNDARY: each phase write moves data.chain.checked by EXACTLY 2 audit entries — its own update row plus the record-edit gate_passed trace — never merely '>= 2'", () => {
    // reason: spec-documents-are-living-or-records D16 — a phase write on an open plan now passes the
    // record-edit gate, and the enforcer leaves one `gate_passed` audit row for that evaluation (AC-FR-8/D7)
    // next to the write's own `update` row. Exactly two, per write: an unpaired extra row would show here.
    expect(steps.map((s) => s.verify.chain.checked)).toEqual([
      baseline.chain.checked + 2,
      baseline.chain.checked + 4,
      baseline.chain.checked + 6,
    ]);
  });

  it("BOUNDARY non-vacuity: the reconcile watermark precedes the fixture's own version rows, so misses[] was never vacuously empty", () => {
    const watermark = Date.parse(steps[steps.length - 1]?.verify.since ?? "");
    const earliest = Date.parse(earliestVersionAt);
    expect(Number.isNaN(watermark), `data.since is not a parseable timestamp`).toBe(false);
    expect(Number.isNaN(earliest), `the earliest version row's created_at is not a parseable timestamp`).toBe(false);
    expect(
      watermark,
      `data.since (${steps[steps.length - 1]?.verify.since}) is after the fixture's earliest version row (${earliestVersionAt}) — every misses[] assertion above would be vacuous`,
    ).toBeLessThanOrEqual(earliest);
  });

  it("the anchor cross-check reports 'absent' throughout, so no anchor state silently coloured these verdicts", () => {
    expect(steps.map((s) => s.verify.anchor.status)).toEqual(["absent", "absent", "absent"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Green controls — the reader above must be shown to discriminate
// ────────────────────────────────────────────────────────────────────────────

describe("green controls — a tampered audit trail is reported, so the clean verdicts above are measurements", () => {
  let anchorTampered: AuditVerifyReading;
  let anchorRestored: AuditVerifyReading;
  let orphanBefore: AuditVerifyReading;
  let orphanAfter: AuditVerifyReading;
  let orphanDocId = "";

  beforeAll(() => {
    // ── Control 1: an anchor naming a chain row that does not exist ──
    const anchorFixture = makeApprovedPlan("Phase audit pairing anchor control");
    const seed = runLoreInFixture(["phase", "add", anchorFixture.slug, "P1", "--json"], anchorFixture.dir);
    if (seed.exitCode !== 0) throw new Error(`anchor-control seed \`phase add\` failed (exit ${seed.exitCode}): ${seed.stderr}`);

    const anchorPath = join(anchorFixture.dir, ".lore", "audit-anchor.json");
    writeFileSync(
      anchorPath,
      `${JSON.stringify({ head_id: 999_999, head_hash: "0".repeat(64), entry_count: 1, anchored_at: "2026-01-01T00:00:00.000Z" }, null, 2)}\n`,
      "utf8",
    );
    anchorTampered = readAuditVerify(anchorFixture.dir);
    unlinkSync(anchorPath);
    anchorRestored = readAuditVerify(anchorFixture.dir);

    // ── Control 2: a version row with no paired audit entry ──
    const orphanFixture = makeApprovedPlan("Phase audit pairing orphan-row control");
    const orphanSeed = runLoreInFixture(["phase", "add", orphanFixture.slug, "P1", "--json"], orphanFixture.dir);
    if (orphanSeed.exitCode !== 0) throw new Error(`orphan-control seed \`phase add\` failed (exit ${orphanSeed.exitCode}): ${orphanSeed.stderr}`);

    orphanDocId = planIdAndEarliestVersionAt(orphanFixture.dir, orphanFixture.slug).docId;
    orphanBefore = readAuditVerify(orphanFixture.dir);
    insertOrphanVersionRow(orphanFixture.dir, orphanDocId);
    orphanAfter = readAuditVerify(orphanFixture.dir);
  }, 180_000);

  // ── Control 1 — proves `clean` and the exit code discriminate ──

  it("control 1: a mismatched audit anchor makes data.clean false and the command exit 4", () => {
    expect(anchorTampered.clean).toBe(false);
    expect(anchorTampered.exitCode).toBe(4);
    expect(anchorTampered.anchor.status).toBe("anchor_mismatch");
  });

  it("control 1: the anchor mismatch leaves misses[] and chain.clean untouched, so the three readers are independent", () => {
    expect(anchorTampered.misses.length).toBe(0);
    expect(anchorTampered.chain.clean).toBe(true);
  });

  it("control 1: deleting the anchor file returns the SAME corpus to clean/exit 0, so the tamper was the cause", () => {
    expect(anchorRestored.clean).toBe(true);
    expect(anchorRestored.exitCode).toBe(0);
    expect(anchorRestored.anchor.status).toBe("absent");
  });

  // ── Control 2 — proves the completeness join itself discriminates ──

  it("control 2: the corpus is clean BEFORE the orphan row is inserted", () => {
    expect(orphanBefore.clean).toBe(true);
    expect(orphanBefore.exitCode).toBe(0);
    expect(orphanBefore.misses.length).toBe(0);
  });

  it("control 2: one version row with no paired audit entry produces exactly one miss, clean false and exit 4", () => {
    expect(orphanAfter.clean).toBe(false);
    expect(orphanAfter.exitCode).toBe(4);
    expect(orphanAfter.misses.length).toBe(1);
  });

  it("control 2: the miss names the exact (doc_id, version) that was left unpaired", () => {
    expect(orphanAfter.misses[0]).toMatchObject({ doc_id: orphanDocId, version: ORPHAN_VERSION, action: "update" });
  });

  it("control 2: the chain walk stays clean, so `misses` is measured independently of chain integrity", () => {
    expect(orphanAfter.chain.clean).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// REGRESSION — the structural mirror of the behaviour asserted above
// ────────────────────────────────────────────────────────────────────────────

describe("REGRESSION — writePhases still routes doc, version and audit through one atomic writer", () => {
  let phaseService = "";

  beforeAll(() => {
    phaseService = readFileSync(PHASE_SERVICE_PATH, "utf8");
  });

  it("phase-service.ts calls the atomic doc+version+audit writer", () => {
    expect(
      countOccurrences(phaseService, ATOMIC_WRITER_CALL),
      `${PHASE_SERVICE_PATH} no longer contains \`${ATOMIC_WRITER_CALL}\` — the phase write path has stopped committing the version row and its audit entry as one unit`,
    ).toBeGreaterThanOrEqual(1);
  });

  it("phase-service.ts contains NO bare version write — that is exactly the severed shape SPEC-148 C5 measured", () => {
    expect(
      countOccurrences(phaseService, BARE_VERSION_WRITE_CALL),
      `${PHASE_SERVICE_PATH} contains \`${BARE_VERSION_WRITE_CALL}\`; a version row written outside \`${ATOMIC_WRITER_CALL}\` is what makes \`lore audit --verify\` report a miss`,
    ).toBe(0);
  });

  it("CONTROL: the bare-version-write pattern matches the call shape it is aimed at, so the zero above is not a mis-aimed grep", () => {
    expect(
      countOccurrences(BARE_WRITER_CONTROL_SAMPLE, BARE_VERSION_WRITE_CALL),
      `the pattern \`${BARE_VERSION_WRITE_CALL}\` no longer matches a bare version write — the control for the preceding zero has evaporated`,
    ).toBe(1);
  });
});
