/**
 * Phase-write lifecycle + doc-parity oracle — the SINGLE file behind SPEC-148's
 * AC-PHASEVER-1, AC-PHASEVER-2 and AC-PHASEVER-3
 * (`spec-lore-phase-add-and-phase-rm-mutate-a-plan-s-declared`, v35).
 *
 * @spec_ref AC-PHASEVER-1
 * @spec_ref AC-PHASEVER-2
 * @spec_ref AC-PHASEVER-3
 *
 * ## What is being pinned
 *
 * `adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan` (accepted,
 * chosen by the human project owner on 2026-08-24) decides:
 *
 *   **Phase writes SHALL log a version row. They SHALL NOT demote the plan.**
 *
 * So `addPhase` / `removePhase` / `renamePhase` each gain an `insertVersion`
 * while leaving `status` untouched — adding a phase to an `approved` plan keeps
 * it `approved`. ⛔ `resolveStatusAfterContractEdit` MUST NOT be called from
 * `PhaseService`: that is the alternative the ADR rejected BY NAME, and the
 * spec's Risks section calls it the live implementation trap (an implementer who
 * pattern-matches `ac set` rather than `ac add` will add a demotion nobody asked
 * for, forcing re-approval on every phase edit).
 *
 * ## This suite is RED ON PURPOSE at the commit that introduces it
 *
 * Written red-first, BEFORE the implementation task. Measured in this worktree
 * (`92ace82f`, rebased onto main 2026-08-24) — each row names the assertion that
 * is currently failing and what must change:
 *
 *   | predicate                                              | now | must be |
 *   |--------------------------------------------------------|-----|---------|
 *   | forbidden clause in root CLAUDE.md                     |  1  |    0    |
 *   | required literal in root CLAUDE.md                     |  0  |    1    |
 *   | files under `packages/` carrying a banned phrase        |  2  |    0    |
 *   | ADR slug in `phase-service.ts`'s header                 |  0  |    1    |
 *   | ADR slug in `ac-service.ts`'s header                    |  0  |    1    |
 *   | `phase add`   raises `lore log --json` `data.total` by   |  0  |   +1    |
 *   | `phase rename` raises it by                             |  0  |   +1    |
 *   | `phase rm`     raises it by                              |  0  |   +1    |
 *
 * ⛔ A GREEN run of this file at the introducing commit means the suite is
 * DEFECTIVE, not that the work is done.
 *
 * Three conjuncts are ALREADY GREEN and are labelled as such at their assertion
 * sites, so their pass is never banked as coverage of this change:
 *   - "status stays `approved`" for all three writers — true today because the
 *     writers touch no status at all. It is half the decision, and it must STILL
 *     hold after the change; that is what makes it worth asserting.
 *   - AC-PHASEVER-3(c)'s demotion guard — VACUOUSLY green (there is no
 *     implementation yet for it to constrain). It is a REGRESSION GUARD over the
 *     Risks trap above, per the spec's explicit instruction to say so out loud.
 *   - AC-PHASEVER-2(b)'s premise record — satisfied 2026-08-24 by the accepted
 *     ADR. Asserted because it must not silently disappear, not because this
 *     task achieved it.
 *
 * ## Invocation shape — pinned by the spec, not chosen here
 *
 * - The CLI is reached through THIS WORKTREE'S OWN SOURCE
 *   (`<repo>/packages/lore/src/index.ts`), never a prebuilt `dist/lore`: that
 *   binary is whatever commit last ran `bun run build`, so a suite spawning it
 *   measures a DIFFERENT commit and reports the verdict as if it measured this
 *   change. `assertEntryUnderTest()` REFUSES the mistake (it runs on every
 *   spawn) rather than merely avoiding it.
 * - vitest is the pinned runner, so nothing here may top-level-import
 *   `bun:sqlite` or anything that transitively does. That is what forces the
 *   subprocess shape instead of an in-process `createApp` — the in-process
 *   version is what a reader reaches for first, and it fails under vitest for
 *   reasons unrelated to this spec.
 * - Every write goes to a `mkdtemp` + `lore init` throwaway corpus with `HOME`
 *   redirected inside it. `runLoreInFixture` refuses any cwd that is not a
 *   fixture THIS FILE created.
 * - Version rows are read as `lore log <plan> --json` → `data.total` (pinned by
 *   the spec; printed lines are refused because `--limit` defaults to 20). The
 *   reader additionally asserts `entries.length === total`, so a truncated
 *   answer fails loud instead of under-counting.
 *
 * ## Green controls — one per negative, in the SAME vitest process
 *
 * Every negative here is guarded by a writer that DOES the thing, measured
 * through the same apparatus:
 *   - AC-1 and AC-2 EACH run their own `lore set --content` control (demotes
 *     `approved`→`draft` AND raises `data.total`). AC-2's is not inherited from
 *     AC-1: the AC commands select AC-2 with `-t`, so AC-1's block does not run,
 *     and a control in a different invocation is not a control.
 *   - AC-3(c)'s zero-counts in `phase-service.ts` are controlled by the same
 *     count against `ac-service.ts`, which is nonzero — so the zeros are not a
 *     mis-aimed grep.
 *   - AC-3(d)'s "0 files" grep is controlled by the SAME invocation shape
 *     (`grep -rIl -e … packages/`, same cwd) run with a pattern known to be
 *     present, which must return >= 1 file.
 *
 * ## Reading the live corpus: `audit` + `list` only, and why not `get`
 *
 * AC-PHASEVER-2(b) is a claim about THIS repo's corpus (an accepted ADR reachable
 * from this spec), so it cannot be measured in a throwaway. Two consequences,
 * both deliberate:
 *   1. A git worktree carries no `.lore/` of its own, so `findLoreDbPath` walks
 *      up and resolves the MAIN checkout's corpus. File-based assertions read
 *      THIS worktree's files; corpus assertions read the shared corpus. That
 *      split is a property of the setup, not a bug, and it is why the two halves
 *      are never conflated below.
 *   2. MEASURED 2026-08-24: `lore get` APPENDS a row to the live corpus'
 *      `trace_events` table (`lore trace stats`'s `get` counter moved 10640 →
 *      10641 across one read), while `lore audit` and `lore list` move nothing.
 *      So this suite reads the live corpus with `audit` and `list` ONLY and never
 *      `get` — otherwise every full-suite run would inflate `trace_events` and
 *      quietly launder these two docs out of `lore trace stats`' "never-read
 *      docs" signal. `runLoreReadOnlyInRepo` enforces the allowlist.
 *
 * `lore audit <spec>` is also the STRONGER reader for the edge's direction: an
 * `action: "link"` row is written on the FROM doc with `details.to_id`, so a
 * `link` row on the spec naming the ADR proves the edge is OUTBOUND from the
 * spec. `lore get`'s `navigation.related` is built from `findLinks(id, "both")`
 * and therefore cannot distinguish direction at all.
 *
 * ## ⛔ This file lives under `packages/`, which collides with AC-PHASEVER-3(d)
 *
 * AC-PHASEVER-3(d) pins its match rule as
 * `grep -rIl -e <phrase A> -e <phrase B> packages/` == 0 files, with no
 * `--exclude` and no path filter, while the task mandates a suite title that
 * CONTAINS phrase B verbatim. Both cannot hold if this file spells either phrase
 * out: the grep would match this suite and the criterion could never reach 0, no
 * matter what the implementation did. The resolution is at the SOURCE level —
 * both phrases are assembled by concatenation here and never written
 * contiguously anywhere in this file, so the pinned match rule stays exactly as
 * the spec pinned it. `guards its own source against the banned phrases` below
 * fails loud if anyone ever joins the literals back up.
 *
 * ## Six-dimension coverage
 *
 *   HAPPY:      each of `phase add` / `rename` / `rm` exits 0, mutates
 *               `phases[]`, adds exactly one version row, and leaves the plan
 *               `approved`
 *   NEGATIVE:   status must NOT become `draft`; the banned phrases must NOT
 *               appear under `packages/`; the forbidden CLAUDE.md clause must
 *               NOT appear; `resolveStatusAfterContractEdit` must NOT appear in
 *               `phase-service.ts`
 *   BOUNDARY:   the delta is EXACTLY +1 per write (never ">= 1"); the ADR sits at
 *               DEPTH 1 via a direct `relates-to` edge, never transitive
 *               reachability; the required CLAUDE.md literal appears EXACTLY once
 *   ERROR:      exit codes asserted with `toBe(0)`, never "non-zero"; every
 *               reader throws loudly on a truncated or unparseable envelope
 *   STATE:      each write's effect on `phases[]` is read back INDEPENDENTLY
 *               (`lore phase list`), so "no new version row" can never be
 *               confused with "the command silently did nothing"
 *   REGRESSION: AC-3(c)'s demotion guard (vacuous today) and the "still
 *               `approved`" halves, which must survive the change
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Locations ──────────────────────────────────────────────────────────────

/** Repo root — four levels up from `packages/lore/tests/integration/`. Re-asserted on every spawn. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");

/** The CLI entry under test: this worktree's own SOURCE. ⛔ Never `dist/lore` — see the header. */
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

const CLAUDE_MD_PATH = join(REPO_ROOT, "CLAUDE.md");
const PHASE_SERVICE_PATH = join(REPO_ROOT, "packages", "lore", "src", "service", "phase-service.ts");
const AC_SERVICE_PATH = join(REPO_ROOT, "packages", "lore", "src", "service", "ac-service.ts");

/** This file's own path — read back by the self-guard that protects the split literals below. */
const SELF_PATH = fileURLToPath(import.meta.url);

const SPEC_SLUG = "spec-lore-phase-add-and-phase-rm-mutate-a-plan-s-declared";
const ADR_SLUG = "adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan";

/** Actor for fixture writes. Never reaches the live corpus — fixture runs only. */
const ACTOR = "test:phase-write-lifecycle-doc-parity";

// ─── The pinned literals ────────────────────────────────────────────────────

/**
 * AC-PHASEVER-1(a), forbidden half. The clause the root CLAUDE.md lifecycle
 * paragraph carries TODAY and must stop carrying: its logging half becomes false
 * the moment the ADR's decision lands.
 *
 * ⛔ Fixed string, never a regex. MEASURED trap, recorded so it is not
 * re-introduced: the regex ``phase add\|rm`[^.]*logs a version`` returns 1
 * AGAINST THE CURRENT FALSE LINE, because "neither demotes NOR logs a version"
 * contains "logs a version". Every looser matcher measured so far is
 * green-on-arrival with zero discriminating power.
 */
const FORBIDDEN_CLAUSE = "neither demotes NOR logs a version";

/**
 * AC-PHASEVER-1(a), required half — NORMATIVE, copied character-for-character
 * from the criterion including backticks and capitalization. A semantically
 * correct paragraph worded differently FAILS this on purpose.
 */
const REQUIRED_CLAUSE = "`lore phase add|rm` does NOT demote but LOGS a version";

/**
 * The two phrases AC-PHASEVER-3(d) bans from every file under `packages/`.
 *
 * ⛔ Assembled by CONCATENATION, and never written contiguously anywhere in this
 * file — including in prose. Reason (load-bearing, see the header section "This
 * file lives under `packages/`"): this suite lives under `packages/`, so a
 * spelled-out literal would make the pinned oracle match THIS FILE and the
 * criterion could never reach 0. Splitting here is what lets the criterion keep
 * its pinned match rule with no `--exclude` and no path filter.
 */
const BANNED_PHRASE_A = "no version" + " history";
const BANNED_PHRASE_B = "version" + "-less";

/** AC-PHASEVER-3(d)'s green control: a pattern known present under `packages/`, run through the SAME grep shape. */
const GREP_CONTROL_PATTERN = "insertVersion";

/** The identifier AC-PHASEVER-3(c) forbids in `phase-service.ts` and requires in `ac-service.ts` (its control). */
const DEMOTION_HELPER = "resolveStatusAfterContractEdit";

/** ⛔ EXACT suite title addressed by AC-PHASEVER-2's `-t` filter. A typo makes the filter select nothing, and vitest reports selecting nothing as SUCCESS. */
const AC2_SUITE_TITLE = "rename and rm measured and premise recorded";

/** ⛔ EXACT suite title addressed by AC-PHASEVER-3's `-t` filter — assembled from the split literal so this file cannot match its own grep. */
const AC3_SUITE_TITLE = `stale ${BANNED_PHRASE_B} assertions swept and demotion guarded`;

// ─── Primitives ─────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Occurrences of a FIXED string in `haystack`. Refuses an empty needle — that would silently return a length. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) throw new Error("refusing to count occurrences of an empty needle");
  return haystack.split(needle).length - 1;
}

/**
 * A file's leading `/** … *\/` block comment — what SPEC-148 and the ADR both
 * mean by "the header" at `phase-service.ts:5` / `ac-service.ts:8`. Throws when
 * the file does not open with one, so deleting a header can never read as
 * "0 banned phrases, criterion satisfied".
 */
function leadingBlockComment(source: string, label: string): string {
  if (!source.startsWith("/**")) {
    throw new Error(`${label} does not open with a /** … */ header block — AC-PHASEVER-3(e) has nothing to measure`);
  }
  const end = source.indexOf("*/");
  if (end === -1) throw new Error(`${label}'s leading block comment is unterminated`);
  return source.slice(0, end + 2);
}

/**
 * ⛔ The refusal AC-PHASEVER-1's invocation-shape clause demands. Runs on EVERY
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
  for (const proof of [CLAUDE_MD_PATH, PHASE_SERVICE_PATH, AC_SERVICE_PATH]) {
    if (!existsSync(proof)) throw new Error(`${REPO_ROOT} is not the repo under test — ${proof} is missing`);
  }
}

/** Fixture directories this file created. Nothing outside this list is ever a write target. */
const fixtureDirs: string[] = [];

/** A throwaway `HOME` for the repo READ-ONLY runs, so no global lore state on the machine is read or written. */
const readOnlyHome = mkdtempSync(join(tmpdir(), "lore-phasever-home-"));

function spawnLore(args: readonly string[], cwd: string, home: string): RunResult {
  assertEntryUnderTest();
  const proc = spawnSync("bun", [LORE_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
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
  return spawnLore(args, dir, dir);
}

/**
 * The ONLY door to the live corpus. Allowlist is `audit` + `list`: both were
 * MEASURED to leave `trace_events` untouched, whereas `lore get` appends a row
 * (see the header). Anything else — and any write verb — is refused here rather
 * than discovered afterwards in the team's knowledge base.
 */
const LIVE_CORPUS_ALLOWED_VERBS: readonly string[] = ["audit", "list"];

function runLoreReadOnlyInRepo(args: readonly string[]): RunResult {
  const verb = args[0];
  if (verb === undefined || !LIVE_CORPUS_ALLOWED_VERBS.includes(verb)) {
    throw new Error(
      `refusing to run \`lore ${args.join(" ")}\` against the live corpus — only ${LIVE_CORPUS_ALLOWED_VERBS.join("/")} are allowed here`,
    );
  }
  return spawnLore(args, REPO_ROOT, readOnlyHome);
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

// ─── Fixture-corpus readers ─────────────────────────────────────────────────

/**
 * The version-row count — `lore log <plan> --json`'s `data.total`, the reader the
 * spec pins. Also asserts `entries.length === total`: a truncated answer must
 * fail loud rather than silently under-count and make a missing row look present.
 */
function versionTotal(dir: string, slug: string): number {
  const data = jsonEnvelope<{ entries: readonly unknown[]; total: number }>(
    runLoreInFixture(["log", slug, "--json"], dir),
    `lore log ${slug} --json`,
  );
  if (typeof data.total !== "number") throw new Error(`lore log ${slug} --json carries no numeric data.total`);
  if (data.entries.length !== data.total) {
    throw new Error(`lore log ${slug} --json is truncated: ${data.entries.length} entries vs data.total ${data.total}`);
  }
  return data.total;
}

/** The plan's CURRENT status, read from the fixture corpus (a throwaway, so `get` is free to trace). */
function docStatus(dir: string, slug: string): string {
  const data = jsonEnvelope<{ doc: { status: string } }>(
    runLoreInFixture(["get", slug, "--json"], dir),
    `lore get ${slug} --json`,
  );
  if (typeof data.doc.status !== "string") throw new Error(`lore get ${slug} --json carries no doc.status`);
  return data.doc.status;
}

/**
 * The declared phase names, read back INDEPENDENTLY of the write command's own
 * output. Non-vacuity guard: without it, "the version count did not move" is
 * indistinguishable from "the write silently did nothing".
 */
function phaseNames(dir: string, slug: string): readonly string[] {
  const data = jsonEnvelope<{ phases: ReadonlyArray<{ name: string }> }>(
    runLoreInFixture(["phase", "list", slug, "--json"], dir),
    `lore phase list ${slug} --json`,
  );
  return data.phases.map((p) => p.name);
}

/** `mkdtemp` + `lore init` + an APPROVED plan. Setup steps throw loudly; only the writes under test get `expect`ed exit codes. */
function makeApprovedPlan(title: string): { readonly dir: string; readonly slug: string } {
  const dir = mkdtempSync(join(tmpdir(), "lore-phasever-"));
  fixtureDirs.push(dir);

  const init = spawnLore(["init", "--author", "phasever-oracle"], dir, dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed (exit ${init.exitCode}): ${init.stderr}`);
  if (!existsSync(join(dir, ".lore", "lore.db"))) {
    throw new Error(`lore init did not create ${join(dir, ".lore", "lore.db")} — a later verb would walk up to a foreign corpus`);
  }

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

// ─── Live-corpus readers (`audit` + `list` only) ────────────────────────────

interface AuditEntry {
  readonly action?: string;
  readonly details?: unknown;
}

/**
 * Counts audit rows of `action` on the SPEC that name `toId` with link type
 * `wantedType`. `action: "link"` / `"unlink"` rows are written on the FROM doc
 * with `details.to_id` (corpus-service.ts), so a row here proves the edge's
 * DIRECTION — outbound from the spec — which `navigation.related` cannot
 * (it is built from `findLinks(id, "both")`).
 *
 * `unlink` rows carry `link_type` as the ARRAY of removed types, so both shapes
 * are accepted for the same `wantedType`.
 */
function countLinkAuditRows(
  entries: readonly AuditEntry[],
  action: "link" | "unlink",
  toId: string,
  wantedType: string,
): number {
  let hits = 0;
  for (const entry of entries) {
    if (entry.action !== action) continue;
    const details = entry.details;
    if (typeof details !== "object" || details === null) continue;
    const record = details as Record<string, unknown>;
    if (record["to_id"] !== toId) continue;
    const linkType = record["link_type"];
    const namesWanted = linkType === wantedType || (Array.isArray(linkType) && linkType.includes(wantedType));
    if (namesWanted) hits += 1;
  }
  return hits;
}

interface DocSummaryRow {
  readonly id: string;
  readonly slug: string;
  readonly type: string;
  readonly meta?: { readonly decision_status?: string };
  readonly validity_status?: { readonly invalidated?: boolean };
}

// ─── `grep`, in the shape the criterion pins ────────────────────────────────

/**
 * `grep -rIl -e <pattern>… packages/` from the repo root — AC-PHASEVER-3(d)'s
 * pinned match rule, verbatim: no `--exclude`, no path filter. Exit 1 (no match)
 * is a legitimate empty answer; anything else is a broken invocation and throws,
 * so a mis-aimed grep can never read as "0 files".
 */
function grepFilesUnderPackages(patterns: readonly string[]): readonly string[] {
  const args = ["-rIl"];
  for (const pattern of patterns) args.push("-e", pattern);
  args.push("packages/");
  const proc = spawnSync("grep", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (proc.status === null) throw new Error(`grep was killed by signal ${String(proc.signal)}`);
  if (proc.status !== 0 && proc.status !== 1) {
    throw new Error(`grep ${args.join(" ")} failed with exit ${proc.status}: ${proc.stderr}`);
  }
  const files = (proc.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (proc.status === 1 && files.length > 0) {
    throw new Error(`grep exited 1 ("no match") yet printed ${files.length} path(s) — the invocation is not being read correctly`);
  }
  return files;
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

afterAll(() => {
  const base = tmpdir();
  for (const dir of [...fixtureDirs, readOnlyHome]) {
    if (dir === "" || !dir.startsWith(base)) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Invocation-shape guards (run by AC-PHASEVER-1's whole-file command)
// ────────────────────────────────────────────────────────────────────────────

describe("invocation shape and corpus safety guards", () => {
  it("resolves its CLI entry to this repo's own source, never a prebuilt binary", () => {
    expect(() => assertEntryUnderTest()).not.toThrow();
  });

  it("resolves that entry to the source file, not a dist artefact", () => {
    expect(LORE_ENTRY).toBe(join(REPO_ROOT, "packages", "lore", "src", "index.ts"));
  });

  it("refuses a fixture write against any cwd it did not create", () => {
    expect(() => runLoreInFixture(["phase", "add", "whatever", "P1"], REPO_ROOT)).toThrow(
      /not a fixture this file created/,
    );
  });

  it("refuses a non-read verb against the live corpus", () => {
    expect(() => runLoreReadOnlyInRepo(["set", SPEC_SLUG, "--content", "x"])).toThrow(/only audit\/list are allowed/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC-PHASEVER-1 — CLAUDE.md parity + a measured `phase add`, with its own control
// ────────────────────────────────────────────────────────────────────────────

interface Ac1Measurement {
  readonly totalAfterApprove: number;
  readonly statusAfterApprove: string;
  readonly addExitCode: number;
  readonly phasesAfterAdd: readonly string[];
  readonly totalAfterAdd: number;
  readonly statusAfterAdd: string;
  readonly controlExitCode: number;
  readonly statusAfterControl: string;
  readonly totalAfterControl: number;
}

describe("AC-PHASEVER-1 — CLAUDE.md parity and a measured phase add against a demoting control", () => {
  let claudeMd = "";
  let m: Ac1Measurement;

  beforeAll(() => {
    claudeMd = readFileSync(CLAUDE_MD_PATH, "utf8");

    const { dir, slug } = makeApprovedPlan("Phasever AC1 approved plan");
    const totalAfterApprove = versionTotal(dir, slug);
    const statusAfterApprove = docStatus(dir, slug);

    const add = runLoreInFixture(["phase", "add", slug, "P1", "--json"], dir);
    const phasesAfterAdd = phaseNames(dir, slug);
    const totalAfterAdd = versionTotal(dir, slug);
    const statusAfterAdd = docStatus(dir, slug);

    // GREEN CONTROL, same process as the negatives it guards: a writer that DOES
    // demote and DOES log. Without it, "status stayed approved" is
    // indistinguishable from "the status reader is broken", and "the count did
    // not move" from "the counter is broken".
    const control = runLoreInFixture(["set", slug, "--content", "Control content bump.", "--json"], dir);
    const statusAfterControl = docStatus(dir, slug);
    const totalAfterControl = versionTotal(dir, slug);

    m = {
      totalAfterApprove,
      statusAfterApprove,
      addExitCode: add.exitCode,
      phasesAfterAdd,
      totalAfterAdd,
      statusAfterAdd,
      controlExitCode: control.exitCode,
      statusAfterControl,
      totalAfterControl,
    };
  }, 60_000);

  // ── (a) DOC PARITY — two fixed-string counts in the root CLAUDE.md ──

  it("(a) root CLAUDE.md no longer says phase writes log nothing", () => {
    expect(countOccurrences(claudeMd, FORBIDDEN_CLAUSE), `forbidden clause still in ${CLAUDE_MD_PATH}`).toBe(0);
  });

  it("(a) root CLAUDE.md carries the required literal exactly once", () => {
    expect(countOccurrences(claudeMd, REQUIRED_CLAUSE), `required literal missing from ${CLAUDE_MD_PATH}`).toBe(1);
  });

  // ── (b) LIVE measurement — BOTH conjuncts, separately ──

  it("(b) `lore phase add` on an approved plan exits 0", () => {
    expect(m.addExitCode).toBe(0);
  });

  it("(b) STATE non-vacuity: the phase really was appended", () => {
    expect(m.phasesAfterAdd).toEqual(["P1"]);
  });

  it("(b) `lore phase add` raises `lore log --json` data.total by exactly 1", () => {
    expect(m.totalAfterAdd, `data.total before the add was ${m.totalAfterApprove}`).toBe(m.totalAfterApprove + 1);
  });

  it("(b) `lore phase add` leaves the plan approved — ALREADY GREEN today, and half the decision, so it must stay", () => {
    expect(m.statusAfterAdd).toBe("approved");
  });

  it("(b) the plan was genuinely approved before the phase write", () => {
    expect(m.statusAfterApprove).toBe("approved");
  });

  // ── (c) GREEN CONTROL, same run ──

  it("(c) control `lore set --content` exits 0", () => {
    expect(m.controlExitCode).toBe(0);
  });

  it("(c) control `lore set --content` DOES demote approved → draft, so the status reader discriminates", () => {
    expect(m.statusAfterControl).toBe("draft");
  });

  it("(c) control `lore set --content` DOES raise data.total by exactly 1, so the counter discriminates", () => {
    expect(m.totalAfterControl).toBe(m.totalAfterAdd + 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC-PHASEVER-2 — ⛔ title addressed verbatim by the AC's `-t` filter
// ────────────────────────────────────────────────────────────────────────────

interface Ac2Measurement {
  readonly totalBeforeRename: number;
  readonly statusBeforeRename: string;
  readonly renameExitCode: number;
  readonly phasesAfterRename: readonly string[];
  readonly totalAfterRename: number;
  readonly statusAfterRename: string;
  readonly rmExitCode: number;
  readonly phasesAfterRm: readonly string[];
  readonly totalAfterRm: number;
  readonly statusAfterRm: string;
  readonly controlExitCode: number;
  readonly statusAfterControl: string;
  readonly totalAfterControl: number;
}

interface PremiseRecord {
  readonly adrId: string;
  readonly adrDecisionStatus: string | undefined;
  readonly adrInvalidated: boolean | undefined;
  readonly adrListReturned: number;
  readonly adrListTotal: number;
  readonly auditReturned: number;
  readonly auditTotal: number;
  readonly outboundRelatesToRows: number;
  readonly unlinkRelatesToRows: number;
  readonly outboundParentRows: number;
}

describe(AC2_SUITE_TITLE, () => {
  let m: Ac2Measurement;
  let premise: PremiseRecord;

  beforeAll(() => {
    const { dir, slug } = makeApprovedPlan("Phasever AC2 approved plan");
    // Setup only — AC-PHASEVER-1 owns the `phase add` measurement. Here it merely
    // puts a phase in place for `rename` and `rm` to act on.
    const seed = runLoreInFixture(["phase", "add", slug, "P1", "--json"], dir);
    if (seed.exitCode !== 0) throw new Error(`fixture \`phase add\` failed (exit ${seed.exitCode}): ${seed.stderr}`);

    const totalBeforeRename = versionTotal(dir, slug);
    const statusBeforeRename = docStatus(dir, slug);

    const rename = runLoreInFixture(["phase", "rename", slug, "P1", "P1x", "--json"], dir);
    const phasesAfterRename = phaseNames(dir, slug);
    const totalAfterRename = versionTotal(dir, slug);
    const statusAfterRename = docStatus(dir, slug);

    const rm = runLoreInFixture(["phase", "rm", slug, "P1x", "--json"], dir);
    const phasesAfterRm = phaseNames(dir, slug);
    const totalAfterRm = versionTotal(dir, slug);
    const statusAfterRm = docStatus(dir, slug);

    // (a2) GREEN CONTROL — required in THIS run, ⛔ never inherited from
    // AC-PHASEVER-1: the AC command selects this block with `-t`, so AC-1's block
    // does not execute and its control would not exist.
    const control = runLoreInFixture(["set", slug, "--content", "Control content bump."], dir);
    const statusAfterControl = docStatus(dir, slug);
    const totalAfterControl = versionTotal(dir, slug);

    m = {
      totalBeforeRename,
      statusBeforeRename,
      renameExitCode: rename.exitCode,
      phasesAfterRename,
      totalAfterRename,
      statusAfterRename,
      rmExitCode: rm.exitCode,
      phasesAfterRm,
      totalAfterRm,
      statusAfterRm,
      controlExitCode: control.exitCode,
      statusAfterControl,
      totalAfterControl,
    };

    // ── (b) the premise record, read from the LIVE corpus with `list` + `audit` only ──
    const adrList = jsonEnvelope<{ docs: readonly DocSummaryRow[]; total: number }>(
      runLoreReadOnlyInRepo(["list", "--type", "adr", "--json"]),
      "lore list --type adr --json",
    );
    if (adrList.docs.length !== adrList.total) {
      throw new Error(`lore list --type adr --json is truncated: ${adrList.docs.length} rows vs total ${adrList.total}`);
    }
    const adr = adrList.docs.find((row) => row.slug === ADR_SLUG);
    if (adr === undefined) throw new Error(`no ADR named ${ADR_SLUG} in this corpus — AC-PHASEVER-2(b) has nothing to measure`);

    const audit = jsonEnvelope<{ entries: readonly AuditEntry[]; total: number }>(
      runLoreReadOnlyInRepo(["audit", SPEC_SLUG, "--limit", "10000", "--json"]),
      `lore audit ${SPEC_SLUG} --json`,
    );
    if (audit.entries.length !== audit.total) {
      throw new Error(`lore audit ${SPEC_SLUG} --json is truncated: ${audit.entries.length} entries vs total ${audit.total} — raise --limit`);
    }

    premise = {
      adrId: adr.id,
      adrDecisionStatus: adr.meta?.decision_status,
      adrInvalidated: adr.validity_status?.invalidated,
      adrListReturned: adrList.docs.length,
      adrListTotal: adrList.total,
      auditReturned: audit.entries.length,
      auditTotal: audit.total,
      outboundRelatesToRows: countLinkAuditRows(audit.entries, "link", adr.id, "relates-to"),
      unlinkRelatesToRows: countLinkAuditRows(audit.entries, "unlink", adr.id, "relates-to"),
      outboundParentRows: countLinkAuditRows(audit.entries, "link", adr.id, "parent"),
    };
  }, 90_000);

  // ── (a) `phase rename` — both conjuncts, explicitly ──

  it("(a) `lore phase rename` on an approved plan exits 0", () => {
    expect(m.renameExitCode).toBe(0);
  });

  it("(a) STATE non-vacuity: the rename really landed", () => {
    expect(m.phasesAfterRename).toEqual(["P1x"]);
  });

  it("(a) `lore phase rename` raises data.total by exactly 1", () => {
    expect(m.totalAfterRename, `data.total before the rename was ${m.totalBeforeRename}`).toBe(m.totalBeforeRename + 1);
  });

  it("(a) `lore phase rename` leaves the plan approved — ALREADY GREEN, and the ADR-rejected demotion must never appear", () => {
    expect(m.statusAfterRename).toBe("approved");
  });

  // ── (a) `phase rm` — both conjuncts, explicitly ──

  it("(a) `lore phase rm` on an approved plan exits 0", () => {
    expect(m.rmExitCode).toBe(0);
  });

  it("(a) STATE non-vacuity: the removal really landed", () => {
    expect(m.phasesAfterRm).toEqual([]);
  });

  it("(a) `lore phase rm` raises data.total by exactly 1", () => {
    expect(m.totalAfterRm, `data.total before the rm was ${m.totalAfterRename}`).toBe(m.totalAfterRename + 1);
  });

  it("(a) `lore phase rm` leaves the plan approved — ALREADY GREEN, and the ADR-rejected demotion must never appear", () => {
    expect(m.statusAfterRm).toBe("approved");
  });

  it("(a) the plan was genuinely approved before rename and rm ran", () => {
    expect(m.statusBeforeRename).toBe("approved");
  });

  // ── (a2) GREEN CONTROL in THIS run ──

  it("(a2) control `lore set --content` exits 0", () => {
    expect(m.controlExitCode).toBe(0);
  });

  it("(a2) control `lore set --content` DOES demote approved → draft in this very run", () => {
    expect(m.statusAfterControl).toBe("draft");
  });

  it("(a2) control `lore set --content` DOES raise data.total by exactly 1 in this very run", () => {
    expect(m.totalAfterControl).toBe(m.totalAfterRm + 1);
  });

  // ── (b) the premise question has a recorded answer ──
  // ⛔ ALREADY SATISFIED 2026-08-24. Asserted so it cannot silently vanish; its
  // pass is NOT coverage of this change. The oracle asserts reachability +
  // `accepted`, NEVER a particular conclusion.

  it("(b) an outbound `relates-to` edge runs from this spec to the ADR at depth 1", () => {
    expect(
      premise.outboundRelatesToRows,
      `no audit row on ${SPEC_SLUG} records a relates-to link to ${premise.adrId} (${premise.auditReturned} entries scanned)`,
    ).toBeGreaterThanOrEqual(1);
  });

  it("(b) that edge was never unlinked afterwards", () => {
    expect(premise.unlinkRelatesToRows).toBe(0);
  });

  it("(b) the ADR's decision_status is accepted", () => {
    expect(premise.adrDecisionStatus).toBe("accepted");
  });

  // ⛔ `validity_status` off a `list` row is ADVISORY, not authoritative — CLAUDE.md:
  // "a listed doc is NOT proven live — validity is authoritative only by direct
  // address". Kept anyway because `invalidated: true` here would be a real signal;
  // the criterion's own requirement is the `accepted` assertion above.
  it("(b) the ADR is not listed as retracted", () => {
    expect(premise.adrInvalidated).toBe(false);
  });

  it("(b) the edge is a relates-to edge, NOT the tree parent edge in disguise", () => {
    expect(premise.outboundParentRows).toBe(0);
  });

  it("(b) the audit scan was complete, so a missing link row means absent and never truncated", () => {
    expect(premise.auditTotal).toBe(premise.auditReturned);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC-PHASEVER-3 — ⛔ title addressed verbatim by the AC's `-t` filter
// ────────────────────────────────────────────────────────────────────────────

interface Ac3Measurement {
  readonly phaseServiceDemotionHelperHits: number;
  readonly phaseServiceSingleQuotedDraft: number;
  readonly phaseServiceDoubleQuotedDraft: number;
  readonly acServiceDemotionHelperHits: number;
  readonly bannedPhraseFiles: readonly string[];
  readonly grepControlFiles: readonly string[];
  readonly phaseServiceHeaderAdrHits: number;
  readonly acServiceHeaderAdrHits: number;
  readonly selfBannedPhraseAHits: number;
  readonly selfBannedPhraseBHits: number;
}

describe(AC3_SUITE_TITLE, () => {
  let m: Ac3Measurement;

  beforeAll(() => {
    const phaseSource = readFileSync(PHASE_SERVICE_PATH, "utf8");
    const acSource = readFileSync(AC_SERVICE_PATH, "utf8");
    const selfSource = readFileSync(SELF_PATH, "utf8");

    m = {
      phaseServiceDemotionHelperHits: countOccurrences(phaseSource, DEMOTION_HELPER),
      phaseServiceSingleQuotedDraft: countOccurrences(phaseSource, "'draft'"),
      phaseServiceDoubleQuotedDraft: countOccurrences(phaseSource, '"draft"'),
      acServiceDemotionHelperHits: countOccurrences(acSource, DEMOTION_HELPER),
      bannedPhraseFiles: grepFilesUnderPackages([BANNED_PHRASE_A, BANNED_PHRASE_B]),
      grepControlFiles: grepFilesUnderPackages([GREP_CONTROL_PATTERN]),
      phaseServiceHeaderAdrHits: countOccurrences(leadingBlockComment(phaseSource, PHASE_SERVICE_PATH), ADR_SLUG),
      acServiceHeaderAdrHits: countOccurrences(leadingBlockComment(acSource, AC_SERVICE_PATH), ADR_SLUG),
      selfBannedPhraseAHits: countOccurrences(selfSource, BANNED_PHRASE_A),
      selfBannedPhraseBHits: countOccurrences(selfSource, BANNED_PHRASE_B),
    };
  }, 30_000);

  // ── (c) NEGATIVE GUARD — ⛔ VACUOUSLY GREEN today. A regression guard over the
  //    ADR-rejected demotion, NEVER coverage of this change.

  it("(c) phase-service.ts never calls the demotion helper — VACUOUS today, regression guard", () => {
    expect(m.phaseServiceDemotionHelperHits).toBe(0);
  });

  it("(c) phase-service.ts contains no single-quoted draft literal — VACUOUS today, regression guard", () => {
    expect(m.phaseServiceSingleQuotedDraft).toBe(0);
  });

  it("(c) phase-service.ts contains no double-quoted draft literal — VACUOUS today, regression guard", () => {
    expect(m.phaseServiceDoubleQuotedDraft).toBe(0);
  });

  it("(c) CONTROL: ac-service.ts DOES reference the demotion helper, so those zeros are not a mis-aimed grep", () => {
    expect(m.acServiceDemotionHelperHits).toBeGreaterThanOrEqual(1);
  });

  // ── (d) NEGATIVE closed set, pinned match rule ──

  it("(d) no file under packages/ still asserts that phase writes record nothing", () => {
    expect(m.bannedPhraseFiles, `still carrying a banned phrase: ${m.bannedPhraseFiles.join(", ")}`).toEqual([]);
  });

  it("(d) CONTROL: the same grep shape DOES find files for a pattern known present", () => {
    expect(m.grepControlFiles.length).toBeGreaterThanOrEqual(1);
  });

  it("(d) guards its own source against the banned phrases — this file lives under packages/", () => {
    expect(m.selfBannedPhraseAHits + m.selfBannedPhraseBHits, "this suite would match its own grep and (d) could never reach 0").toBe(0);
  });

  // ── (e) POSITIVE requirement — the paraphrase-proof half ──

  it("(e) phase-service.ts's header cites the ADR exactly once", () => {
    expect(m.phaseServiceHeaderAdrHits, `${PHASE_SERVICE_PATH}'s header must cite ${ADR_SLUG}`).toBe(1);
  });

  it("(e) ac-service.ts's header cites the ADR exactly once", () => {
    expect(m.acServiceHeaderAdrHits, `${AC_SERVICE_PATH}'s header must cite ${ADR_SLUG}`).toBe(1);
  });
});

