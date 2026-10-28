// @spawns packages/lore/src/index.ts
// @reads packages/core/src/doc-type-meta.ts
// @reads packages/lore/src/adapters/cli/commands/list.ts
/**
 * `lore list --json` ROW CONTRACT — the single file behind AC-MOS-1 of
 * `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by`.
 *
 * @spec_ref AC-MOS-1
 *
 * ## What is being pinned
 *
 * `lore list --json` has SIX emit branches. Five print gated FULL records
 * (`--governed-by`, `--phase`, `--type task`, `--include-invalid`, `--plan-id`);
 * only the default fall-through prints the store's summary projection. Until
 * 2026-08-25 the five printed their fetched rows VERBATIM, so one command
 * answered `--json` with TWO row contracts:
 *
 *   | invocation (measured 2026-08-25 @ 3331a98e) | bytes      | keys           |
 *   |---------------------------------------------|------------|----------------|
 *   | `--type knowledge --json`                   |    313,281 | 10, with `meta`|
 *   | `--type knowledge --json --include-invalid` | 23,180,068 | 18, NO `meta`  |
 *   | `--type task --json`                        |          — | 18, NO `meta`  |
 *
 * The CANONICAL row is the DEFAULT branch's, and it is a CLOSED set of ten keys
 * ({@link CANONICAL_ROW_KEYS}). "Closed" is load-bearing: an `expect(keys).toEqual`
 * over the sorted set cannot be satisfied by every branch converging on the WIDE
 * shape instead, the way a containment check could.
 *
 * ⛔ The FETCH is not the defect. Those branches need full records because the
 * validity gate and the `--plan-id`/`--phase` narrowing all read `extra`, which
 * `DocSummary` does not carry. The fix projects at the EMIT site only — see
 * `toListJsonRows` in `packages/lore/src/adapters/cli/commands/list.ts`.
 *
 * ⛔ `meta` must come from `deriveTypeMeta` (`packages/core/src/doc-type-meta.ts`),
 * the SSOT. Dropping `meta` altogether would ALSO make the key sets match and is the
 * cheap wrong answer; that is why every type this file exercises has its discriminant
 * asserted by VALUE, not merely its presence counted. ⛔ "Every type it exercises" is
 * itself enforced, not left to the author: {@link ASSERTED_DISCRIMINANT_TYPES} is
 * compared against the types actually present across every capture, so seeding a
 * seventh type reddens this suite until its discriminant is asserted too.
 *
 * ## MEASURED 2026-08-25 — the per-emit-site mutation sweep
 *
 * The AC claims one invocation per emit site. That claim was MEASURED rather than
 * reasoned, by reverting each of `list.ts`'s five `toListJsonRows(...)` call sites to
 * printing its full records, one at a time, and recording which assertions reddened:
 *
 *   | call site | branch              | suite | assertions reddened            |
 *   |-----------|---------------------|-------|--------------------------------|
 *   | line 439  | `--governed-by`     | 1/13  | the `--governed-by` case only  |
 *   | line 565  | `--phase`           | 3/13  | pinned equality, leak, task meta |
 *   | line 607  | `--type task`       | 4/13  | + STATE                        |
 *   | line 659  | `--include-invalid` | 5/13  | + knowledge/adr/plan, prd      |
 *   | line 705  | `--plan-id` alone   | 1/13  | the `--plan-id` case only      |
 *
 * Every site is discriminated — the suite has no blind emit branch. Two consequences
 * are recorded here because neither is visible from the AC text:
 *
 * 1. ⛔ AC-MOS-1's enumeration of six invocations does NOT map one-per-emit-site.
 *    `list.ts` tests `--governed-by`, then `--phase`, then `--type task`, then
 *    `--include-invalid`, then `--plan-id`. So its `--type task --plan-id <p>` entry
 *    is absorbed by the `--type task` branch at line 607 and NEVER reaches line 705 —
 *    proved above, where mutating 607 reddens that capture and mutating 705 does not.
 *    The AC's six therefore touch only FIVE distinct sites. This file covers the sixth
 *    by pinning `--plan-id` WITHOUT `--type` as well ({@link PINNED_EMIT_SITES}), which
 *    is a deliberate widening beyond the AC's letter, not a restatement of it.
 * 2. The two fixture-B sites are each guarded by a single assertion, where the three
 *    fixture-A sites are guarded by three to five. That asymmetry is why both are now
 *    members of the pinned set rather than of a separate "branches never reached"
 *    block: it brings them under the named-leak NEGATIVE check too.
 *
 * ⛔ This coverage was ALREADY complete before the task that produced this comment.
 * That task was dispatched on the premise that `grep -c governed` over this file
 * returned 0 and that reverting line 439 would therefore leave the suite GREEN. BOTH
 * halves were false: the mutation reddened the `--governed-by` case on the unmodified
 * file, and the grep returned nothing only because a raw NUL byte in this file's own
 * source (see {@link distinctKeySets}) made `grep` treat it as binary and suppress
 * every match. The grep was the false witness, not the suite.
 *
 * ## What that task therefore changed, and the red proving each part
 *
 * Since `list.ts` needed nothing, the work landed on the ORACLE's own failure modes.
 * Each addition was falsified by a probe that must redden it and nothing unrelated:
 *
 *   | probe                                          | before | after                    |
 *   |------------------------------------------------|--------|--------------------------|
 *   | revert line 439 to `fullDocs`                   | 1 red  | 3 red (equality, leak, case) |
 *   | drop `--governed-by` from the pinned set        | GREEN  | label-set equality red   |
 *   | stop exercising the `spec` type                 | GREEN  | type-closure red         |
 *
 * The first row is the hardening: `--governed-by` was guarded by ONE assertion and is
 * now guarded by three, because it moved from a side block into the pinned set and so
 * came under the named-leak NEGATIVE check. Rows two and three are new discriminating
 * power outright — both mutations were green before, and both are ORACLE-SHAPE
 * regressions (an invocation quietly dropped, a run quietly narrowed) that no
 * `list.ts` mutation can expose, which is exactly why the suite could not see them.
 *
 * ## Two fixtures, and the honest reason there are two
 *
 * `deriveTypeMeta` returns `undefined` for `prd` by documented design (that type has
 * no meta variant), so a `prd` row is a NINE-key row — on the default branch too.
 * The pinned invocations therefore run against corpora that deliberately return no `prd`
 * row, or the bare `--include-invalid` invocation could never satisfy a ten-key EQUALITY.
 * That exclusion is a real narrowing of the criterion, so it is closed here rather than
 * left implicit:
 *
 *   - {@link FIXTURE_TEN_KEY} — plan / knowledge / adr / task, NO prd and NO spec.
 *     Runs five of the seven pinned invocations. Every row: exactly ten keys.
 *   - {@link FIXTURE_FULL_TYPE} — prd / spec / plan / task / a `skill` knowledge doc.
 *     Covers the two types fixture A structurally cannot hold: `spec` (which the
 *     criterion names in its discriminant table, and which the corpus refuses to
 *     create without a `prd` parent), and `prd` ITSELF — where the assertion is
 *     branch-to-branch IDENTITY rather than the ten-key literal. That is the stronger
 *     statement for that shape: it fails both if a wide branch re-widens AND if
 *     someone "repairs" the missing tenth key by fabricating `meta: null`.
 *
 * Fixture B also supplies the other two pinned invocations — `--governed-by` and the
 * `--plan-id`-without-`--type` fall-through — because neither can run against fixture A:
 * the first needs a `skill` doc plus a `governs` link, and the second needs a plan whose
 * members are reachable without a `--type task` narrowing that would re-route the branch.
 *
 * ## Invocation shape
 *
 * - The CLI is reached through THIS WORKTREE'S OWN SOURCE
 *   (`<repo>/packages/lore/src/index.ts`), never a prebuilt `dist/lore` — that binary
 *   is whatever commit last ran `bun run build`, so a suite spawning it measures a
 *   DIFFERENT commit and reports the verdict as if it measured this change.
 *   {@link assertEntryUnderTest} REFUSES the mistake on every spawn rather than
 *   merely avoiding it. Apparatus shape borrowed from
 *   `packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts`.
 * - vitest is the pinned runner, so nothing here may import `bun:sqlite` — that is
 *   what forces the subprocess shape instead of an in-process `createApp`.
 * - ⛔ Every write goes to a `mkdtemp` + `lore init` throwaway with `HOME` redirected
 *   inside it. {@link runLoreInFixture} refuses any cwd that is not a fixture THIS
 *   FILE created. This file NEVER touches the repo's own `.lore/`.
 * - All spawning happens ONCE in `beforeAll`; the `it` bodies assert over captured
 *   output. Measured ~29 spawns at ~0.4s each, hence the declared hook budget — the
 *   default 30s hookTimeout was sized for a single case, not a fixture builder.
 *
 * ## Six-dimension coverage
 *
 *   HAPPY:      each of the seven pinned invocations — AC-MOS-1's six plus the
 *               `--plan-id`-alone site its enumeration misses — returns rows whose
 *               sorted key set EQUALS the ten-key canonical set
 *   NEGATIVE:   no row of any pinned invocation carries `content` or `extra` — nor any
 *               of the other seven wide-only keys ({@link WIDE_ONLY_KEYS}), so a partial
 *               projection that dropped only the two big fields still fails, and it
 *               fails NAMING the keys that leaked
 *   BOUNDARY:   `prd`, the one type whose tenth key is legitimately absent, asserted
 *               as default-branch/wide-branch IDENTITY; an empty result set; a
 *               `--type` narrowing that returns zero rows; the pinned LABEL SET is
 *               asserted by equality, so dropping an invocation reddens the suite
 *               instead of silently shrinking what it covers
 *   ERROR:      exit codes asserted with `toBe(0)`, never "non-zero"; a `status: null`
 *               spawn (ENOBUFS/signal) throws NAMING the signal instead of being
 *               laundered into an exit code; every envelope read throws on a
 *               non-`ok` or unparseable payload
 *   STATE:      the task's `meta` is read BEFORE and AFTER `lore evidence` records an
 *               `expected-fail` row — `evidence_expected_fail` must be ABSENT then
 *               PRESENT, which proves `meta` is derived from live `extra` at read
 *               time and is not a frozen literal that happens to look right
 *   REGRESSION: `--include-invalid` must return STRICTLY MORE rows than the bare
 *               default listing (the D3 exclusion still works after the projection),
 *               and the retracted row must carry `validity_status.invalidated === true`
 */

import { beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureRequirementsDocSlug } from "../helpers/parented-create.js";
// ─── Locations ──────────────────────────────────────────────────────────────

/** Repo root — four levels up from `packages/lore/tests/integration/`. Re-asserted on every spawn. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");

/** The CLI entry under test: this worktree's own SOURCE. ⛔ Never `dist/lore` — see the header. */
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

/** The two surfaces this criterion is about — their absence proves `REPO_ROOT` is not the repo under test. */
const LIST_COMMAND_PATH = join(REPO_ROOT, "packages", "lore", "src", "adapters", "cli", "commands", "list.ts");
const DOC_TYPE_META_PATH = join(REPO_ROOT, "packages", "core", "src", "doc-type-meta.ts");

/** Actor for fixture writes. Never reaches the live corpus — fixture runs only. */
const ACTOR = "test:list-json-row-contract";

// ─── The pinned key sets ────────────────────────────────────────────────────

/**
 * THE CANONICAL ROW — a CLOSED set of ten keys, sorted, exactly as AC-MOS-1 names
 * them. Asserted with `toEqual` (equality), ⛔ never `arrayContaining` (containment):
 * containment stays true if a branch prints all eighteen.
 */
const CANONICAL_ROW_KEYS = [
  "id",
  "meta",
  "priority",
  "slug",
  "status",
  "tags",
  "title",
  "type",
  "updated_at",
  "validity_status",
] as const;

/**
 * The nine keys the WIDE (`DocRecord`) shape carried and the row contract does not.
 * Asserted separately from the equality above so a HALF-projection — one that dropped
 * only the two large fields `content`/`extra` the diagnosis named, and kept the other
 * seven — reports which keys leaked rather than a bare "sets differ".
 */
const WIDE_ONLY_KEYS = [
  "content",
  "created_at",
  "created_by",
  "deleted_at",
  "extra",
  "ordinal",
  "parent_id",
  "role",
  "version",
] as const;

/** A `prd` row: the canonical set MINUS `meta`, which `deriveTypeMeta` refuses to derive for that type. */
const PRD_ROW_KEYS = CANONICAL_ROW_KEYS.filter((k) => k !== "meta");

/**
 * AC-MOS-1's SIX enumerated invocations, verbatim and sorted. Pinned as a SET rather
 * than counted: `size === 6` stays true if one invocation is swapped for a duplicate of
 * another, which is exactly how the criterion's own enumeration came to touch only five
 * distinct emit sites (see the header's mutation sweep).
 */
const AC_MOS_1_INVOCATIONS = [
  "--governed-by",
  "--include-invalid",
  "--type knowledge",
  "--type task",
  "--type task --phase",
  "--type task --plan-id",
] as const;

/**
 * The emit site AC-MOS-1's enumeration MISSES. `--plan-id` reaches its own branch only
 * when no `--type task` / `--phase` / `--include-invalid` claimed the request first, so
 * the criterion's `--type task --plan-id` entry is absorbed by the `--type task` branch
 * and this bare form is the only invocation that exercises line 705. MEASURED in the
 * header's sweep: mutating 705 reddens this capture and nothing else.
 */
const UNENUMERATED_EMIT_SITES = ["--plan-id"] as const;

/** Every invocation held to the canonical row contract: the criterion's six plus the site it misses. */
const PINNED_LABELS = [...AC_MOS_1_INVOCATIONS, ...UNENUMERATED_EMIT_SITES].sort();

/**
 * The types whose `deriveTypeMeta` discriminant this file asserts BY VALUE. Compared
 * against the types actually present across every capture ({@link PINNED_EMIT_SITES}
 * and both fixtures' extra reads), so AC-MOS-1(b)'s "for EVERY type the run exercises"
 * is enforced by the suite rather than by whoever last edited the fixtures. ⛔ Seeding a
 * new type without asserting its discriminant reddens the closure test, which is the
 * whole point: the clause is otherwise vacuously satisfiable by exercising fewer types.
 */
const ASSERTED_DISCRIMINANT_TYPES = ["adr", "knowledge", "plan", "prd", "spec", "task"];

// ─── Primitives ─────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** One emitted `--json` row, read structurally — the point of this suite is its KEY SET, so it is never typed to a fixed shape. */
type EmittedRow = Record<string, unknown>;

interface ListPayload {
  readonly docs: EmittedRow[];
  readonly total: number;
}

/**
 * ⛔ The refusal the spec's invocation-shape clause demands. Runs on EVERY spawn, so
 * "we used the source, honest" is never taken on trust.
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
  for (const proof of [LIST_COMMAND_PATH, DOC_TYPE_META_PATH]) {
    if (!existsSync(proof)) throw new Error(`${REPO_ROOT} is not the repo under test — ${proof} is missing`);
  }
}

/** Fixture directories this file created. Nothing outside this list is ever a write target. */
const fixtureDirs: string[] = [];

function spawnLore(args: readonly string[], dir: string): RunResult {
  assertEntryUnderTest();
  const proc = spawnSync("bun", [LORE_ENTRY, ...args], {
    cwd: dir,
    encoding: "utf8",
    // reason: explicit, and paired with the `status === null` refusal below. spawnSync
    // reports a buffer overflow as `status: null` + `error.code: "ENOBUFS"`, never a
    // nonzero exit — the exact silent conversion AC-MOS-2 exists to close. A `?? 1`
    // here would launder it into "the command exited 1" with empty stderr.
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      HOME: dir,
      EDITOR: "true",
      // reason: SPEC-024 — AI is OFF for agent surfaces. Pinned explicitly rather than
      // inherited so a developer shell without CLAUDECODE=1 cannot make this suite
      // nest a Claude call inside `lore create`.
      CI: "true",
      LORE_AI_DEFAULT: "off",
      LORE_ACTOR: ACTOR,
    },
  });
  if (proc.status === null) {
    throw new Error(
      `lore ${args.join(" ")} produced no exit code — signal ${String(proc.signal)}, error ${String(proc.error?.message)}`,
    );
  }
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", exitCode: proc.status };
}

/** Runs any verb against a throwaway corpus THIS FILE created. ⛔ Refuses every other cwd. */
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout.trim());
  } catch (cause) {
    throw new Error(`${label} did not emit a JSON envelope: ${JSON.stringify(run.stdout.slice(0, 400))}`, { cause });
  }
  const envelope = parsed as { ok?: boolean; data?: T };
  if (envelope.ok !== true || envelope.data === undefined) {
    throw new Error(`${label} returned a non-ok envelope: ${JSON.stringify(parsed).slice(0, 400)}`);
  }
  return envelope.data;
}

/** A setup write that MUST succeed — throws loudly rather than letting a later assertion fail for the wrong reason. */
function mustSucceed(args: readonly string[], dir: string): RunResult {
  const run = runLoreInFixture(args, dir);
  if (run.exitCode !== 0) {
    throw new Error(`fixture setup \`lore ${args.join(" ")}\` exited ${run.exitCode}: ${run.stderr.trim() || run.stdout.trim()}`);
  }
  return run;
}

/** Reads one `lore list ... --json` invocation, asserting the envelope's shape rather than trusting it. */
function readListing(args: readonly string[], dir: string): ListPayload {
  const label = `lore ${args.join(" ")}`;
  const data = jsonEnvelope<{ docs?: unknown; total?: unknown }>(runLoreInFixture(args, dir), label);
  if (!Array.isArray(data.docs)) throw new Error(`${label} carries no data.docs array`);
  if (typeof data.total !== "number") throw new Error(`${label} carries no numeric data.total`);
  if (data.docs.length !== data.total) {
    throw new Error(`${label} is inconsistent: ${data.docs.length} rows vs data.total ${data.total}`);
  }
  return { docs: data.docs as EmittedRow[], total: data.total };
}

/** `mkdtemp` + `lore init`, registered as a legal write target. */
function makeFixture(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirs.push(dir);
  const init = spawnLore(["init", "--author", "row-contract-oracle"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed (exit ${init.exitCode}): ${init.stderr}`);
  if (!existsSync(join(dir, ".lore", "lore.db"))) {
    throw new Error(`lore init did not create ${join(dir, ".lore", "lore.db")} — a later verb would walk up to a foreign corpus`);
  }
  return dir;
}

/** The sorted key set of one emitted row — the unit every assertion in this file compares. */
function sortedKeys(row: EmittedRow): string[] {
  return Object.keys(row).sort();
}

/** Every distinct sorted key set present in a listing, so "all rows agree" and "they agree on the RIGHT set" stay separable. */
function distinctKeySets(rows: readonly EmittedRow[]): string[][] {
  const seen = new Map<string, string[]>();
  for (const row of rows) {
    const keys = sortedKeys(row);
    // reason: NUL is the separator because no corpus key name can contain one, so the
    // join is unambiguous. ⛔ It MUST stay the ESCAPE `\u0000` and never a raw NUL byte
    // typed into the source. A literal NUL made `file(1)` classify this file as `data`,
    // and BSD `grep` then suppresses every match in it SILENTLY — no "binary file
    // matches" line, exit 1, no output. Measured 2026-08-25: `grep -c governed` on this
    // file printed nothing while the file held ten occurrences, which is what produced
    // this task's false premise that `--governed-by` was uncovered. Any grep-shaped
    // structural oracle over this file is blind while a raw NUL is present.
    seen.set(keys.join("\u0000"), keys);
  }
  return [...seen.values()];
}

/** The `meta` payload of the single row of `type`, throwing when the listing does not hold exactly one such row. */
function soleMetaOfType(payload: ListPayload, type: string): Record<string, unknown> | undefined {
  const rows = payload.docs.filter((row) => row["type"] === type);
  if (rows.length !== 1) throw new Error(`expected exactly one ${type} row, found ${rows.length}`);
  const meta = rows[0]?.["meta"];
  if (meta === undefined) return undefined;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw new Error(`${type} row's meta is not an object: ${JSON.stringify(meta)}`);
  }
  return meta as Record<string, unknown>;
}

// ─── Fixture A: the ten-key corpus (no prd, no spec) ────────────────────────

/** Slugs are derived from titles by the corpus (`{type}-{kebab-title}`) — pinned here so a rename cannot silently un-target an assertion. */
const A_PLAN = "plan-row-contract-plan";
const A_PARENT_SPEC = "spec-row-contract-parent-spec";
const A_KNOWLEDGE_RETRACTED = "knowledge-row-contract-retracted";
const A_KNOWLEDGE_SUCCESSOR = "knowledge-row-contract-successor";
const A_TASK = "task-row-contract-task";
const A_PHASE = "alpha";

interface FixtureACaptures {
  readonly dir: string;
  /** The five pinned invocations this fixture can serve, keyed by a human label. */
  readonly pinned: ReadonlyMap<string, ListPayload>;
  /** The bare default listing — the control for the `--include-invalid` row-count comparison. */
  readonly bareDefault: ListPayload;
  /** `--type task` read BEFORE any evidence was recorded (the STATE dimension's "before"). */
  readonly taskBeforeEvidence: ListPayload;
}

let fixtureA: FixtureACaptures;

/**
 * FIXTURE A — spec (the parent every plan, adr and knowledge row is filed under) / plan / knowledge x2 / adr / task, and deliberately NO prd:
 * every type present here has a derivable `meta`, which is what makes AC-MOS-1's
 * ten-key EQUALITY satisfiable on the bare `--include-invalid` invocation. See the
 * header's "Two fixtures" section for why that exclusion is closed in fixture B
 * rather than left implicit.
 */
const FIXTURE_TEN_KEY = "list-json-row-contract-ten-key-";

function buildFixtureA(): FixtureACaptures {
  const dir = makeFixture(FIXTURE_TEN_KEY);

  // reason: a plan, decision record and knowledge record need a parent (spec-documents-that-need-a-parent-are-refused-without-one-an-ad
  // D6), and fixture A may hold no prd (a prd row has no `meta`). A spec has a derivable `meta`, so the parent is a spec.
  mustSucceed(["create", "spec", "--title", "Row Contract Parent Spec", "--content", B_SPEC_BODY, "--kind", "tech"], dir);
  mustSucceed(["create", "plan", "--parent", A_PARENT_SPEC, "--title", "Row Contract Plan", "--content", "Plan body."], dir);
  mustSucceed(["phase", "add", A_PLAN, A_PHASE], dir);
  mustSucceed(
    ["create", "knowledge", "--parent", A_PARENT_SPEC, "--title", "Row Contract Retracted", "--content", "Retracted body.", "--sub-type", "retro"],
    dir,
  );
  mustSucceed(
    ["create", "knowledge", "--parent", A_PARENT_SPEC, "--title", "Row Contract Successor", "--content", "Successor body.", "--sub-type", "reference"],
    dir,
  );
  mustSucceed(
    ["create", "adr", "--parent", A_PARENT_SPEC, "--title", "Row Contract Adr", "--content", "Adr body.", "--decision-status", "accepted"],
    dir,
  );
  mustSucceed(
    // eslint-disable-next-line prettier/prettier -- one argv, kept on one logical line
    ["create", "task", "--title", "Row Contract Task", "--content", "Task body.", "--parent", A_PLAN, "--plan-id", A_PLAN, "--phase", A_PHASE],
    dir,
  );

  // STATE dimension, "before": the task's meta with ZERO evidence recorded.
  const taskBeforeEvidence = readListing(["list", "--type", "task", "--json"], dir);

  mustSucceed(
    // reason: `--output-tail` is REQUIRED for a self-reported (non-runner) result —
    // with no observed exit code the tail is the only evidence the run happened. This
    // is fixture data, not this suite's own evidence.
    ["evidence", A_TASK, "--oracle", "test", "--command", "fixture probe", "--result", "expected-fail", "--output-tail", "1 failed"],
    dir,
  );
  mustSucceed(
    ["invalidate", A_KNOWLEDGE_RETRACTED, "--superseded-by", A_KNOWLEDGE_SUCCESSOR, "--reason", "fixture retraction"],
    dir,
  );

  const pinned = new Map<string, ListPayload>([
    ["--type knowledge", readListing(["list", "--type", "knowledge", "--json"], dir)],
    ["--include-invalid", readListing(["list", "--include-invalid", "--json"], dir)],
    ["--type task", readListing(["list", "--type", "task", "--json"], dir)],
    ["--type task --plan-id", readListing(["list", "--type", "task", "--plan-id", A_PLAN, "--json"], dir)],
    ["--type task --phase", readListing(["list", "--type", "task", "--phase", A_PHASE, "--json"], dir)],
  ]);
  const bareDefault = readListing(["list", "--json"], dir);

  return { dir, pinned, bareDefault, taskBeforeEvidence };
}

// ─── Fixture B: the full-type corpus (prd, spec, governed-by, plan-id) ──────

const B_PRD = "prd-row-contract-prd";
const B_PLAN = "plan-row-contract-plan-b";
const B_SKILL = "knowledge-row-contract-skill";

/** A spec body the `spec-create` gate accepts: the three required skeleton sections plus one oracle-verifiable criterion. */
const B_SPEC_BODY = [
  "## Overview",
  "",
  "Fixture spec — exists so the `spec` discriminant is exercised by a real row.",
  "",
  "## Scope",
  "",
  "One throwaway corpus.",
  "",
  "## Acceptance Criteria",
  "",
  "- AC-FIX-1: `bun run typecheck` exits 0.",
  "",
].join("\n");

interface FixtureBCaptures {
  readonly dir: string;
  readonly specDefault: ListPayload;
  /** The same `prd` row read through the DEFAULT branch and through a WIDE branch. */
  readonly prdDefault: ListPayload;
  readonly prdWide: ListPayload;
  /** The sixth emit branch, which AC-MOS-1's five invocations never reach. */
  readonly governedBy: ListPayload;
  /** The `--plan-id`-without-`--type` fall-through branch. */
  readonly planIdOnly: ListPayload;
  /** A narrowing that matches nothing — the projection must survive an empty set. */
  readonly emptyNarrowing: ListPayload;
}

let fixtureB: FixtureBCaptures;

/** FIXTURE B — holds the two types fixture A structurally cannot (`prd`, and the `spec` that requires a prd parent), plus the two uncovered emit branches. */
const FIXTURE_FULL_TYPE = "list-json-row-contract-full-type-";

function buildFixtureB(): FixtureBCaptures {
  const dir = makeFixture(FIXTURE_FULL_TYPE);

  mustSucceed(["create", "prd", "--title", "Row Contract Prd", "--content", "Prd body."], dir);
  mustSucceed(
    ["create", "spec", "--title", "Row Contract Spec", "--content", B_SPEC_BODY,"--kind", "tech"],
    dir,
  );
  mustSucceed(["create", "plan", "--parent", ensureRequirementsDocSlug((a) => mustSucceed(a, dir)), "--title", "Row Contract Plan B", "--content", "Plan body."], dir);
  mustSucceed(
    ["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => mustSucceed(a, dir,)), "--title", "Row Contract Skill", "--content", "Skill body.", "--sub-type", "skill"],
    dir,
  );
  mustSucceed(["link", B_SKILL, B_PLAN, "--type", "governs"], dir);
  mustSucceed(
    ["create", "task", "--title", "Row Contract Task B", "--content", "Task body.", "--parent", B_PLAN, "--plan-id", B_PLAN],
    dir,
  );

  return {
    dir,
    specDefault: readListing(["list", "--type", "spec", "--json"], dir),
    prdDefault: readListing(["list", "--type", "prd", "--json"], dir),
    // reason: `--include-invalid` is what routes a `prd` query into a WIDE branch —
    // the type itself is not invalidatable, so this flag is being used purely as the
    // branch selector. That is the point: the same doc, two code paths, one contract.
    prdWide: readListing(["list", "--type", "prd", "--include-invalid", "--json"], dir),
    governedBy: readListing(["list", "--governed-by", B_SKILL, "--json"], dir),
    planIdOnly: readListing(["list", "--plan-id", B_PLAN, "--json"], dir),
    emptyNarrowing: readListing(["list", "--type", "adr", "--json"], dir),
  };
}

// reason: ~29 subprocess spawns at ~0.4s each measured on 2026-08-25. The 30s default
// hookTimeout in vitest.config.ts was sized for a single test CASE; declaring a budget
// for a fixture builder whose cost is a known spawn count is the repo's documented
// pattern, not a mask over a hang.
/**
 * EVERY invocation held to the canonical row contract, spanning both fixtures — the six
 * AC-MOS-1 enumerates plus the `--plan-id`-alone site it misses. Assembled here rather
 * than inside a fixture because two of the seven can only be produced by fixture B; the
 * contract being asserted is a property of the COMMAND, not of either corpus.
 */
let pinnedEmitSites: ReadonlyMap<string, ListPayload>;

/** Every capture this file takes, including the ones outside the pinned set — the input to the type-closure check. */
let allCaptures: ReadonlyMap<string, ListPayload>;

beforeAll(() => {
  fixtureA = buildFixtureA();
  fixtureB = buildFixtureB();

  pinnedEmitSites = new Map<string, ListPayload>([
    ...fixtureA.pinned,
    ["--governed-by", fixtureB.governedBy],
    ["--plan-id", fixtureB.planIdOnly],
  ]);

  allCaptures = new Map<string, ListPayload>([
    ...pinnedEmitSites,
    ["bare default", fixtureA.bareDefault],
    ["--type task (pre-evidence)", fixtureA.taskBeforeEvidence],
    ["--type spec", fixtureB.specDefault],
    ["--type prd", fixtureB.prdDefault],
    ["--type prd --include-invalid", fixtureB.prdWide],
    ["--type adr (empty)", fixtureB.emptyNarrowing],
  ]);
}, 180000);

// ─── The criterion ──────────────────────────────────────────────────────────

describe("one row contract across every --json emit branch", () => {
  describe("AC-MOS-1(a) — every pinned invocation returns the CLOSED ten-key row", () => {
    it("BOUNDARY: the pinned LABEL SET equals AC-MOS-1's six plus the emit site its enumeration misses", () => {
      // ⛔ Equality over the label SET, never `size`. A count stays green when one
      // invocation is swapped for a duplicate of another — which is precisely the
      // defect this assertion exists to name: AC-MOS-1's own six invocations touch
      // only five distinct emit sites, because `--type task --plan-id` is absorbed
      // by the `--type task` branch. See the header's mutation sweep for the proof.
      expect([...pinnedEmitSites.keys()].sort()).toEqual(PINNED_LABELS);
      for (const label of AC_MOS_1_INVOCATIONS) {
        expect(pinnedEmitSites.has(label), `AC-MOS-1 names ${label} but it is not pinned`).toBe(true);
      }
    });

    it("HAPPY: every pinned invocation returns rows whose sorted key set EQUALS the canonical set", () => {
      for (const [label, payload] of pinnedEmitSites) {
        // Non-vacuity: an invocation that returned nothing would satisfy a
        // per-row assertion trivially.
        expect(`${label}: ${payload.total} rows`).toBe(`${label}: ${payload.docs.length} rows`);
        expect(payload.docs.length, `${label} returned no rows — nothing to assert`).toBeGreaterThan(0);
        expect(distinctKeySets(payload.docs), `${label} row key sets`).toEqual([[...CANONICAL_ROW_KEYS]]);
      }
    });

    it("NEGATIVE: no row carries content, extra, or any other wide-only DocRecord key", () => {
      const leaked = new Map<string, string[]>();
      for (const [label, payload] of pinnedEmitSites) {
        const present = WIDE_ONLY_KEYS.filter((key) => payload.docs.some((row) => key in row));
        if (present.length > 0) leaked.set(label, [...present]);
      }
      expect(Object.fromEntries(leaked)).toEqual({});
    });

    it("BOUNDARY: a narrowing that matches nothing returns an empty, well-formed envelope", () => {
      expect(fixtureB.emptyNarrowing.total).toBe(0);
      expect(fixtureB.emptyNarrowing.docs).toEqual([]);
    });
  });

  describe("AC-MOS-1(b) — meta is deriveTypeMeta's, asserted per exercised type", () => {
    it("HAPPY: knowledge, adr and plan carry deriveTypeMeta's discriminant for their type", () => {
      const all = fixtureA.pinned.get("--include-invalid");
      if (all === undefined) throw new Error("the --include-invalid capture is missing");
      // The bare --include-invalid run exercises exactly these types in fixture A.
      expect([...new Set(all.docs.map((row) => row["type"]))].sort()).toEqual(["adr", "knowledge", "plan", "spec", "task"]);

      expect(soleMetaOfType(all, "adr")).toEqual({ t: "adr", decision_status: "accepted" });
      expect(soleMetaOfType(all, "plan")).toEqual({ t: "plan", phase_count: 1 });

      const knowledgeMetas = all.docs
        .filter((row) => row["type"] === "knowledge")
        .map((row) => row["meta"]);
      expect(knowledgeMetas).toEqual(
        expect.arrayContaining([
          { t: "knowledge", sub_type: "retro" },
          { t: "knowledge", sub_type: "reference" },
        ]),
      );
      expect(knowledgeMetas).toHaveLength(2);
    });

    it("HAPPY: task — the discriminant the criterion names explicitly, on every task-shaped invocation", () => {
      const expected = { t: "task", evidence_pass: 0, evidence_fail: 0, evidence_expected_fail: 1 };
      for (const label of ["--include-invalid", "--type task", "--type task --plan-id", "--type task --phase"]) {
        const payload = fixtureA.pinned.get(label);
        if (payload === undefined) throw new Error(`the ${label} capture is missing`);
        expect(soleMetaOfType(payload, "task"), `${label} task meta`).toEqual(expected);
      }
    });

    it("HAPPY: spec — the fourth discriminant the criterion names, exercised in the fixture that can hold one", () => {
      expect(fixtureB.specDefault.total).toBe(1);
      expect(soleMetaOfType(fixtureB.specDefault, "spec")).toEqual({ t: "spec", kind: "tech" });
      expect(distinctKeySets(fixtureB.specDefault.docs)).toEqual([[...CANONICAL_ROW_KEYS]]);
    });

    it("STATE: evidence_expected_fail is ABSENT before `lore evidence` and PRESENT after — meta tracks live extra", () => {
      // ⛔ This is what separates "meta is derived" from "meta is a literal that
      // happens to look right": the SAME doc, read twice, must change.
      expect(soleMetaOfType(fixtureA.taskBeforeEvidence, "task")).toEqual({
        t: "task",
        evidence_pass: 0,
        evidence_fail: 0,
      });
      const after = fixtureA.pinned.get("--type task");
      if (after === undefined) throw new Error("the --type task capture is missing");
      expect(soleMetaOfType(after, "task")).toEqual({
        t: "task",
        evidence_pass: 0,
        evidence_fail: 0,
        evidence_expected_fail: 1,
      });
    });

    it("BOUNDARY: prd — the tenth key is legitimately ABSENT, and identically so on the default and wide branches", () => {
      // ⛔ The assertion here is branch IDENTITY, not the ten-key literal. It fails if
      // a wide branch re-widens AND if someone "repairs" the missing key by
      // fabricating `meta: null` to force the count to ten.
      expect(fixtureB.prdDefault.total).toBe(1);
      expect(fixtureB.prdWide.total).toBe(1);
      const defaultKeys = distinctKeySets(fixtureB.prdDefault.docs);
      const wideKeys = distinctKeySets(fixtureB.prdWide.docs);
      expect(defaultKeys).toEqual([[...PRD_ROW_KEYS]]);
      expect(wideKeys).toEqual(defaultKeys);
      expect("meta" in (fixtureB.prdDefault.docs[0] ?? {})).toBe(false);
      expect("meta" in (fixtureB.prdWide.docs[0] ?? {})).toBe(false);
    });
  });

  describe("the two pinned emit sites only fixture B can reach", () => {
    it("HAPPY: --governed-by — the SIXTH emit site (list.ts line 439), reached via a governs link", () => {
      expect(fixtureB.governedBy.total).toBe(1);
      expect(distinctKeySets(fixtureB.governedBy.docs)).toEqual([[...CANONICAL_ROW_KEYS]]);
      expect(soleMetaOfType(fixtureB.governedBy, "plan")).toEqual({ t: "plan", phase_count: 0 });
    });

    it("HAPPY: --plan-id without --type — the site AC-MOS-1's `--type task --plan-id` never reaches", () => {
      // ⛔ The bare form is load-bearing. Adding `--type task` re-routes the request
      // into the `--type task` branch, so the criterion's own `--type task --plan-id`
      // entry exercises line 607 twice over rather than line 705 once. Measured in the
      // header's sweep: mutating 705 reddens THIS case and no other.
      expect(fixtureB.planIdOnly.total).toBe(1);
      expect(distinctKeySets(fixtureB.planIdOnly.docs)).toEqual([[...CANONICAL_ROW_KEYS]]);
      expect(soleMetaOfType(fixtureB.planIdOnly, "task")).toEqual({
        t: "task",
        evidence_pass: 0,
        evidence_fail: 0,
      });
    });
  });

  describe("AC-MOS-1(b) closure — 'every type the run exercises' is enforced, not trusted", () => {
    it("BOUNDARY: the types present across every capture EQUAL the types whose discriminant is asserted", () => {
      // ⛔ Without this, clause (b) is satisfiable by exercising FEWER types: a run that
      // only ever returned `knowledge` and `task` rows would assert "the discriminant for
      // every type the run exercises" truthfully and prove almost nothing. Equality in
      // BOTH directions is the point — a newly seeded type reddens this until its
      // discriminant is asserted, and deleting an assertion's type reddens it too.
      const exercised = new Set<string>();
      for (const payload of allCaptures.values()) {
        for (const row of payload.docs) {
          const type = row["type"];
          if (typeof type !== "string") throw new Error(`a row carries a non-string type: ${JSON.stringify(row["type"])}`);
          exercised.add(type);
        }
      }
      expect([...exercised].sort()).toEqual(ASSERTED_DISCRIMINANT_TYPES);
    });

    it("BOUNDARY: every capture is non-empty except the one narrowing deliberately built to match nothing", () => {
      // Non-vacuity for the closure above: it reads types out of rows, so a fixture that
      // silently stopped returning rows would shrink `exercised` and the equality would
      // report the wrong cause. Naming the single legal empty capture keeps that visible.
      const empty = [...allCaptures].filter(([, payload]) => payload.docs.length === 0).map(([label]) => label);
      expect(empty).toEqual(["--type adr (empty)"]);
    });
  });

  describe("REGRESSION — the projection did not disable what the branches were fetching full records FOR", () => {
    it("--include-invalid returns EXACTLY the bare listing plus the one retracted row", () => {
      // ⛔ The D3 exclusion is the reason these branches fetch full records at all. A
      // projection that also flattened the exclusion would make every key-set
      // assertion above pass while silently deleting the feature.
      //
      // reason: the delta is asserted as an EXACT +1 whose identity is named, not as
      // two hand-counted absolutes. First written as `toBe(4)`/`toBe(3)` and measured
      // RED (`expected 5 to be 4`) — fixture A holds five docs, not four, because it
      // seeds TWO knowledge docs so the retraction has a successor to point at. The
      // absolute pair was my arithmetic over the fixture, which is exactly the thing
      // an edit to the fixture invalidates; the delta plus the named slug is both
      // stronger (it says WHICH row reappears) and immune to that class of drift.
      // A floor on the bare listing keeps it non-vacuous.
      const all = fixtureA.pinned.get("--include-invalid");
      if (all === undefined) throw new Error("the --include-invalid capture is missing");
      expect(fixtureA.bareDefault.total).toBeGreaterThanOrEqual(3);
      expect(all.total).toBe(fixtureA.bareDefault.total + 1);

      const bareSlugs = new Set(fixtureA.bareDefault.docs.map((row) => row["slug"]));
      const extra = all.docs.map((row) => row["slug"]).filter((slug) => !bareSlugs.has(slug));
      expect(extra).toEqual([A_KNOWLEDGE_RETRACTED]);
    });

    it("the retracted row survives the projection carrying validity_status.invalidated === true", () => {
      const all = fixtureA.pinned.get("--include-invalid");
      if (all === undefined) throw new Error("the --include-invalid capture is missing");
      const retracted = all.docs.filter((row) => {
        const status = row["validity_status"] as { invalidated?: unknown } | undefined;
        return status?.invalidated === true;
      });
      expect(retracted).toHaveLength(1);
      expect(retracted[0]?.["slug"]).toBe(A_KNOWLEDGE_RETRACTED);
      // The successor ULID is carried through the projection, not flattened to a bare boolean.
      const status = retracted[0]?.["validity_status"] as { superseded_by?: unknown };
      expect(typeof status.superseded_by).toBe("string");
    });

    it("the bare default listing excludes the retracted row", () => {
      expect(fixtureA.bareDefault.docs.some((row) => row["slug"] === A_KNOWLEDGE_RETRACTED)).toBe(false);
      expect(fixtureA.bareDefault.docs.some((row) => row["slug"] === A_KNOWLEDGE_SUCCESSOR)).toBe(true);
    });
  });
});
