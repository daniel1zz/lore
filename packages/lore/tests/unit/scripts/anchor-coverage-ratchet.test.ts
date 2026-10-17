// @spawns packages/lore/src/index.ts
// @spawns scripts/check-anchor-coverage.ts
// @reads package.json
// @reads packages/**
// @reads scripts/**
/**
 * Arming suite for `scripts/check-anchor-coverage.ts` — AC-BFI-5 (the ledger
 * dispositions every currently-unanchored live spec) and AC-BFI-6 (the ratchet
 * blocks new debt), of
 * `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor`.
 *
 * WHY EVERY CASE SPAWNS A SUBPROCESS: `scripts/check-anchor-coverage.ts` imports
 * `createApp` (`packages/lore/src/app.ts`), which top-level-imports `bun:sqlite`.
 * That specifier is unresolvable inside a vitest worker (see
 * `scripts/check-ac-ref-integrity-core.ts`'s header for the measured diagnosis),
 * so this suite can never `import` the checker — it drives the REAL
 * `bun run scripts/check-anchor-coverage.ts` entrypoint instead, which is also the
 * exact surface a pre-push wiring task will invoke. Unlike `check-ac-ref-integrity`,
 * this checker has NO `-core.ts` sibling to import for pure coverage: its task's
 * declared file anchors are exactly four paths, and a fifth (shared-helper) module
 * is outside them.
 *
 * ⛔ EXIT CODES ARE ASSERTED WITH `toBe`, NEVER "non-zero". `check-anchor-coverage`
 * uses 0 = clean, 1 = repo-invariant failure, 2 = the scan itself failed (ledger
 * missing/malformed, corpus unreadable). A checker that crashes before inspecting
 * anything also exits non-zero, so a `not.toBe(0)` assertion has zero power to
 * distinguish "the ratchet fired" from "the script threw at import time" — the
 * precise false-oracle vector this repo has recorded seven times.
 * `RunResult.exitCode` therefore reports `-1` (never `1`) for a signal-killed
 * child: `?? 1` would let a killed process masquerade as the very code AC-BFI-6
 * pins.
 *
 * ⛔ NEVER READS OR WRITES THE REPO'S OWN `.lore/` OR ITS SHIPPED LEDGER. Every case
 * that runs the checker (or the independent AC-BFI-10 witness) targets ONE throwaway
 * `mkdtemp` + `lore init` fixture corpus (project CLAUDE.md's canonical pattern) with a
 * fixture ledger injected via `LORE_ANCHOR_COVERAGE_REPO_ROOT`, so the verdict is
 * deterministic and independent of live-corpus drift. The real corpus + shipped ledger
 * is checked by `hooks/pre-push` (`scripts/check-anchor-coverage.ts` itself).
 *
 * Every RED here is a PAIRED transition — break it, then make the IDENTICAL run
 * green — because a bare exit-1 assertion cannot tell a fired ratchet from an
 * unrelated crash, and a bare exit-0 assertion cannot tell a working checker from
 * an inert one.
 *
 * @spec_ref spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor AC-BFI-5, AC-BFI-6
 * @spec_ref adr-a-newly-armed-structural-oracle-enforces-from-a-baseline (baseline + ledger shape)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCorpus } from "../../../src/adapters/cli/corpus-resolution.js";
// AC-BFI-14's shared predicate — imported ONLY by the "one production
// definition" assertions below, never by measureUnanchoredLiveSpecSlugsIndependently
// (that function is the independent witness AC-BFI-10 bought; see its header).
import { isSpecAnchored } from "../../../src/flows/drift-flow.js";
import type { DocRecord } from "@lore/core";

// ─── Paths ──────────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL(".", import.meta.url));
/** `packages/lore/tests/unit/scripts` → repo root is five levels up. */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const CHECKER_SCRIPT = join(REPO_ROOT, "scripts", "check-anchor-coverage.ts");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:anchor-coverage-fixture-test";
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const SCRIPTS_DIR = join(REPO_ROOT, "scripts");
/** The ONE authorized construction site of the anchored predicate (AC-BFI-14). */
const SHARED_PREDICATE_HOME_REL = join("packages", "lore", "src", "flows", "drift-flow.ts");

/**
 * Duplicated from the checker's own `LEDGER_RELATIVE_PATH` because that module
 * cannot be imported here (bun:sqlite, see the header). The duplication is pinned:
 * every success/failure path of the checker prints this exact string, and the
 * HAPPY case below asserts the checker's own output contains it — so renaming the
 * constant on one side fails loud instead of silently pointing the two halves at
 * different files.
 */
const LEDGER_RELATIVE_PATH = "scripts/anchor-coverage-ledger.json";

// ─── Ledger shape (mirrors the checker's Zod schema) ────────────────────────

type Cohort = "deliberate" | "debt";

interface LedgerEntry {
  slug: string;
  cohort: Cohort;
  reason: string;
}

interface LedgerFile {
  baseline_date?: string;
  adr?: string;
  note?: string;
  entries: LedgerEntry[];
}

// ─── Subprocess plumbing ────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  /** The child's real exit code, or `-1` when it was killed by a signal (never `1` — see the header). */
  readonly exitCode: number;
  readonly combined: string;
}

function spawnBun(args: string[], cwd: string, env: NodeJS.ProcessEnv): RunResult {
  const result = spawnSync("bun", args, {
    cwd,
    encoding: "utf8",
    // explicit maxBuffer per this repo's spawnSync-truncation discipline (project CLAUDE.md)
    maxBuffer: 20 * 1024 * 1024,
    env,
  });
  if (result.error !== undefined) {
    throw new Error(`spawn failed: bun ${args.join(" ")} — ${result.error.message}`);
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { stdout, stderr, exitCode: result.status ?? -1, combined: stdout + stderr };
}

/** Spawns the real `lore` CLI from source against `cwd`'s corpus. */
function runLore(args: string[], cwd: string): RunResult {
  return spawnBun(["run", LORE_ENTRY, ...args], cwd, { ...process.env, CLAUDECODE: "1" });
}

/**
 * Spawns the REAL checker. `LORE_ANCHOR_COVERAGE_REPO_ROOT` is DELETED from the
 * child env unless `ledgerRoot` is given — an ambient value inherited from the
 * parent shell would silently redirect the ledger read and make a "shipped ledger"
 * assertion measure some other file, a false green with no symptom.
 */
function runChecker(cwd: string, ledgerRoot?: string): RunResult {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LORE_ANCHOR_COVERAGE_REPO_ROOT;
  if (ledgerRoot !== undefined) env.LORE_ANCHOR_COVERAGE_REPO_ROOT = ledgerRoot;
  return spawnBun(["run", CHECKER_SCRIPT], cwd, env);
}

/** Writes `file` to a throwaway repo root at the exact path the checker reads. */
function initLedgerRoot(file: LedgerFile): string {
  const root = mkdtempSync(join(tmpdir(), "lore-anchor-cov-ledger-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, LEDGER_RELATIVE_PATH), JSON.stringify(file, null, 2), "utf8");
  return root;
}

/** Runs the checker against `cwd`'s corpus with `file` as its ledger, cleaning the throwaway root up afterwards. */
function runCheckerWithLedger(cwd: string, file: LedgerFile): RunResult {
  const root = initLedgerRoot(file);
  try {
    return runChecker(cwd, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Deep-copies a ledger so a mutation in one case can never leak into another. */
function copyLedger(file: LedgerFile): LedgerFile {
  return JSON.parse(JSON.stringify(file)) as LedgerFile;
}

// ─── Fixture corpus (mkdtemp + lore init — NEVER the repo's own .lore/) ─────

const FIXTURE_SPEC_CONTENT =
  "## Overview/Goal\n\nFixture spec for check-anchor-coverage's ratchet test.\n\n" +
  "## Scope\n\nOne throwaway spec used only to prove the anchor-coverage ratchet fires.\n\n" +
  "## Acceptance Criteria\n\n- Declares no code_anchors, so the ratchet must demand a ledger disposition.\n";

function initFixtureCorpus(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const init = runLore(["init", "--json"], dir);
  if (init.exitCode !== 0) {
    throw new Error(`fixture setup: lore init failed (exit ${init.exitCode}): ${init.combined}`);
  }
  return dir;
}

function createDoc(cwd: string, type: string, title: string, content: string, extraArgs: string[]): { id: string; slug: string } {
  const result = runLore(["create", type, "--title", title, "--content", content, "--json", ...extraArgs], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture setup: create ${type} failed (exit ${result.exitCode}): ${result.combined}`);
  }
  const parsed = JSON.parse(result.stdout) as { data: { id: string; slug: string } };
  return { id: parsed.data.id, slug: parsed.data.slug };
}

/** A reason long enough to clear the checker's 20-char floor and specific enough not to be a placeholder. */
const FIXTURE_REASON =
  "Throwaway fixture spec created by the anchor-coverage ratchet suite; it has no implementation to anchor.";

// ─── AC-BFI-5: the ledger dispositions every unanchored live spec ───────────

/**
 * ⛔ Every case in this block runs the checker against ONE throwaway fixture corpus
 * (`mkdtemp` + `lore init`, three unanchored specs) and a ledger shaped like the
 * shipped one — never this repository's own `.lore/` and never the shipped ledger
 * file. The checker only reads the corpus, so one fixture is shared across the block.
 * The same checker run against the real corpus + shipped ledger is `hooks/pre-push`'s
 * job; a unit test that read live state went red whenever unrelated corpus work
 * landed (the TG-3 offender class).
 */
const FIXTURE_UNANCHORED_COUNT = 3;
interface LedgerFixture {
  readonly cwd: string;
  readonly ledger: LedgerFile;
}
let fx: LedgerFixture;

function buildLedgerFixture(): LedgerFixture {
  const cwd = initFixtureCorpus("lore-anchor-cov-shipped-shape-");
  try {
    createDoc(cwd, "prd", "Anchor coverage ledger fixture root", "Fixture prd body.", []);
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < FIXTURE_UNANCHORED_COUNT; i += 1) {
      const spec = createDoc(cwd, "spec", `Anchor coverage ledger fixture spec ${i}`, FIXTURE_SPEC_CONTENT, []);
      entries.push({ slug: spec.slug, cohort: "debt", reason: FIXTURE_REASON });
    }
    return { cwd, ledger: { entries } };
  } catch (error) {
    rmSync(cwd, { recursive: true, force: true });
    throw error;
  }
}

/** A fresh deep copy of the fixture ledger, so a mutation in one case never leaks into another. */
function fixtureLedger(): LedgerFile {
  return copyLedger(fx.ledger);
}

// File-scope hooks: the AC-BFI-5 block AND the AC-BFI-10 block below share this one fixture.
beforeAll(() => {
  fx = buildLedgerFixture();
}, 240000);
afterAll(() => {
  if (fx !== undefined) rmSync(fx.cwd, { recursive: true, force: true });
});

describe("check-anchor-coverage: the ledger dispositions every unanchored live spec (AC-BFI-5)", () => {
  it(
    "HAPPY: the fixture ledger's disposition set EQUALS the freshly measured unanchored live-spec set — exit EXACTLY 0 over a non-trivial, self-reported population",
    () => {
      const result = runCheckerWithLedger(fx.cwd, fixtureLedger());

      expect(result.exitCode).toBe(0);

      // Not a bare exit-0 assertion: a checker that scanned nothing (empty corpus,
      // silently-failed read) would also exit 0. Pin the self-reported census and
      // cross-check its arithmetic.
      const scanned = /scanned (\d+) live spec\(s\) — (\d+) anchored, (\d+) unanchored/.exec(result.combined);
      expect(scanned).not.toBeNull();
      const live = Number(scanned?.[1]);
      const anchored = Number(scanned?.[2]);
      const unanchored = Number(scanned?.[3]);
      expect(live).toBe(FIXTURE_UNANCHORED_COUNT);
      expect(unanchored).toBe(FIXTURE_UNANCHORED_COUNT);
      expect(anchored + unanchored).toBe(live);

      // Set equality's cardinality half, measured against the fixture ledger. Exit 0
      // supplies the other half: a ledger row with no matching unanchored spec is a
      // stale/unknown finding, and an unanchored spec with no row is a missing one —
      // either would have exited 1.
      const shipped = fixtureLedger();
      expect(shipped.entries.length).toBe(unanchored);

      // Pins the duplicated LEDGER_RELATIVE_PATH constant to the checker's own output.
      expect(result.combined).toContain(LEDGER_RELATIVE_PATH);
    },
    60000,
  );

  it(
    "REGRESSION: the verdict is the LAST line on BOTH paths — a tail-window consumer must see what the run concluded, not only the trailing per-row echo",
    () => {
      // Measured this task: with the OK verdict printed BEFORE the 60-row disposition
      // echo, `lore evidence --capture`'s 4000-byte output-tail window kept only the
      // trailing rows and dropped the verdict — an evidence record proving a run
      // happened but not what it decided. This pins the ordering so that regression
      // cannot return silently.
      const green = runCheckerWithLedger(fx.cwd, fixtureLedger());
      expect(green.exitCode).toBe(0);
      const lastGreenLine = green.stdout.trimEnd().split("\n").at(-1);
      expect(lastGreenLine).toMatch(/^check-anchor-coverage: OK — .*0 finding\(s\)\.$/);

      const shipped = fixtureLedger();
      const victim = [...shipped.entries].sort((a, b) => (a.slug < b.slug ? -1 : 1))[0] as LedgerEntry;
      const mutated = copyLedger(shipped);
      mutated.entries = mutated.entries.filter((e) => e.slug !== victim.slug);
      const red = runCheckerWithLedger(fx.cwd, mutated);
      expect(red.exitCode).toBe(1);
      const lastRedLine = red.stderr.trimEnd().split("\n").at(-1);
      expect(lastRedLine).toMatch(/^check-anchor-coverage: FAILED — 1 finding\(s\) in 1 class\(es\): missing_disposition\.$/);
    },
    60000,
  );

  it(
    "RED (a) PAIRED: deleting one fixture ledger row makes the IDENTICAL run exit EXACTLY 1 and NAME that slug; restoring the row exits EXACTLY 0",
    () => {
      const shipped = fixtureLedger();
      expect(shipped.entries.length).toBeGreaterThan(0);

      // Deterministic victim: lexicographically smallest slug, so a re-run picks the
      // same row regardless of file ordering.
      const victim = [...shipped.entries].sort((a, b) => (a.slug < b.slug ? -1 : 1))[0] as LedgerEntry;

      const withRowRemoved = copyLedger(shipped);
      withRowRemoved.entries = withRowRemoved.entries.filter((e) => e.slug !== victim.slug);
      const red = runCheckerWithLedger(fx.cwd, withRowRemoved);

      expect(red.exitCode).toBe(1);
      expect(red.combined).toContain(victim.slug);

      // The failure is the MISSING-disposition class specifically, not some unrelated finding.
      expect(red.combined).toContain("no ledger disposition");

      // The paired green: same corpus, same command, only the row restored.
      const green = runCheckerWithLedger(fx.cwd, copyLedger(shipped));
      expect(green.exitCode).toBe(0);
      expect(green.combined).not.toContain("no ledger disposition");
    },
    60000,
  );

  it(
    "RED (b) PAIRED: replacing one fixture ledger row's reason with 'tbd' makes the IDENTICAL run exit EXACTLY 1 and NAME that slug — the reason predicate is live, not decorative",
    () => {
      const shipped = fixtureLedger();
      expect(shipped.entries.length).toBeGreaterThan(0);
      const victim = [...shipped.entries].sort((a, b) => (a.slug < b.slug ? -1 : 1))[0] as LedgerEntry;

      const withPlaceholderReason = copyLedger(shipped);
      const row = withPlaceholderReason.entries.find((e) => e.slug === victim.slug) as LedgerEntry;
      row.reason = "tbd";
      const red = runCheckerWithLedger(fx.cwd, withPlaceholderReason);

      expect(red.exitCode).toBe(1);
      expect(red.combined).toContain(victim.slug);
      expect(red.combined).toContain("unusable reason");

      const green = runCheckerWithLedger(fx.cwd, copyLedger(shipped));
      expect(green.exitCode).toBe(0);
      expect(green.combined).not.toContain("unusable reason");
    },
    60000,
  );

  it.each([
    ["placeholder, case-insensitive", "TBD"],
    ["placeholder with surrounding whitespace", "  n/a  "],
    ["placeholder punctuation", "-"],
    ["non-empty but under the 20-char floor", "spread out"],
    ["whitespace only", "     "],
  ])(
    "BOUNDARY: a ledger reason that is %s is refused — exit EXACTLY 1, naming the slug",
    (_label, reason) => {
      const shipped = fixtureLedger();
      const victim = [...shipped.entries].sort((a, b) => (a.slug < b.slug ? -1 : 1))[0] as LedgerEntry;

      const mutated = copyLedger(shipped);
      (mutated.entries.find((e) => e.slug === victim.slug) as LedgerEntry).reason = reason;
      const result = runCheckerWithLedger(fx.cwd, mutated);

      expect(result.exitCode).toBe(1);
      expect(result.combined).toContain(victim.slug);
      expect(result.combined).toContain("unusable reason");
    },
    60000,
  );

  it(
    "BOUNDARY: a reason of EXACTLY 20 characters is accepted — the floor is >= 20, not > 20",
    () => {
      const shipped = fixtureLedger();
      const victim = [...shipped.entries].sort((a, b) => (a.slug < b.slug ? -1 : 1))[0] as LedgerEntry;

      const mutated = copyLedger(shipped);
      const twentyChars = "12345678901234567890";
      expect(twentyChars.length).toBe(20);
      (mutated.entries.find((e) => e.slug === victim.slug) as LedgerEntry).reason = twentyChars;

      const result = runCheckerWithLedger(fx.cwd, mutated);
      expect(result.exitCode).toBe(0);
    },
    60000,
  );

  it(
    "ERROR: a missing ledger file exits EXACTLY 2 — the scan-failed class, never conflated with the repo-invariant 1 the ratchet pins",
    () => {
      const emptyRoot = mkdtempSync(join(tmpdir(), "lore-anchor-cov-noledger-"));
      try {
        const result = runChecker(fx.cwd, emptyRoot);
        expect(result.exitCode).toBe(2);
        expect(result.combined).toContain(LEDGER_RELATIVE_PATH);
      } finally {
        rmSync(emptyRoot, { recursive: true, force: true });
      }
    },
    60000,
  );
});

// ─── AC-BFI-6: the ratchet blocks new debt ──────────────────────────────────

describe("check-anchor-coverage: the ratchet blocks new debt (AC-BFI-6)", () => {
  it(
    "RED PAIRED: a live spec declaring no code_anchors and carrying no ledger row exits EXACTLY 1 naming its slug; adding its row makes the IDENTICAL run exit EXACTLY 0",
    () => {
      const cwd = initFixtureCorpus("lore-anchor-cov-ratchet-");
      try {
        const prd = createDoc(cwd, "prd", "Anchor coverage fixture root", "Fixture prd body.", []);
        const spec = createDoc(cwd, "spec", "Anchor coverage fixture unanchored spec", FIXTURE_SPEC_CONTENT, [
        ]);

        // RED: no disposition anywhere.
        const red = runCheckerWithLedger(cwd, { entries: [] });
        expect(red.exitCode).toBe(1);
        expect(red.combined).toContain(spec.slug);
        expect(red.combined).toContain("no ledger disposition");

        // GREEN: the IDENTICAL run, with exactly one row added. The fixture spec was
        // created just now, i.e. after the 2026-07-14 backfill, so its measured cohort
        // is `debt` — a `deliberate` claim here would be refused as a cohort mismatch,
        // which is what makes the cohort field data rather than decoration.
        const green = runCheckerWithLedger(cwd, {
          entries: [{ slug: spec.slug, cohort: "debt", reason: FIXTURE_REASON }],
        });
        expect(green.exitCode).toBe(0);
        expect(green.combined).toContain(spec.slug);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    120000,
  );

  it(
    "NEGATIVE: a ledger row claiming cohort `deliberate` for a spec created AFTER the 2026-07-14 backfill exits EXACTLY 1 naming the slug — the cohort split is measured, not asserted by the author",
    () => {
      const cwd = initFixtureCorpus("lore-anchor-cov-cohort-");
      try {
        const prd = createDoc(cwd, "prd", "Anchor coverage cohort fixture root", "Fixture prd body.", []);
        const spec = createDoc(cwd, "spec", "Anchor coverage cohort fixture spec", FIXTURE_SPEC_CONTENT, [
        ]);

        const red = runCheckerWithLedger(cwd, {
          entries: [{ slug: spec.slug, cohort: "deliberate", reason: FIXTURE_REASON }],
        });
        expect(red.exitCode).toBe(1);
        expect(red.combined).toContain(spec.slug);
        expect(red.combined).toContain("cohort");

        const green = runCheckerWithLedger(cwd, {
          entries: [{ slug: spec.slug, cohort: "debt", reason: FIXTURE_REASON }],
        });
        expect(green.exitCode).toBe(0);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    120000,
  );

  it(
    "NEGATIVE: two ledger rows naming the SAME slug exit EXACTLY 1 — a duplicate disposition is never silently deduped into a pass",
    () => {
      const cwd = initFixtureCorpus("lore-anchor-cov-dup-");
      try {
        const prd = createDoc(cwd, "prd", "Anchor coverage duplicate fixture root", "Fixture prd body.", []);
        const spec = createDoc(cwd, "spec", "Anchor coverage duplicate fixture spec", FIXTURE_SPEC_CONTENT, [
        ]);

        const red = runCheckerWithLedger(cwd, {
          entries: [
            { slug: spec.slug, cohort: "debt", reason: FIXTURE_REASON },
            { slug: spec.slug, cohort: "debt", reason: `${FIXTURE_REASON} (accidental second row)` },
          ],
        });
        expect(red.exitCode).toBe(1);
        expect(red.combined).toContain(spec.slug);
        expect(red.combined).toContain("declared more than once");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    120000,
  );
});

// ─── AC-BFI-10: ledger membership independently of the checker ─────────────

/**
 * Independently measures the set of unanchored live-spec SLUGS — without
 * spawning `scripts/check-anchor-coverage.ts`, and without reading any of its
 * stdout, stderr, or exit code. Reads `.lore/lore.db` directly through the
 * `sqlite3` CLI (already this repo's documented measurement tool — see this
 * spec's own `SELECT COUNT(*) FROM docs WHERE type='spec' ...` example),
 * replicating ONLY the checker's own documented "live spec" population
 * (`type='spec' AND deleted_at IS NULL`, no status filter — see
 * `scripts/check-anchor-coverage.ts`'s module header, "What 'live spec' means
 * here") and its anchored predicate (a non-empty `extra.code_anchors` array,
 * mirroring `isSpecAnchored` there) — via a COMPLETELY DIFFERENT code path
 * (raw SQL over a DB snapshot, never `createApp`/`corpusService.listFull`/the
 * checker's own `isSpecAnchored`), so a regression in the checker's set
 * logic (e.g. collapsing to a pure count) cannot also corrupt this witness.
 *
 * DB path resolution reuses `corpus-resolution.ts::resolveCorpus` — the SAME
 * vitest-safe module `findLoreDbPath` delegates to (see its own header) — so
 * this resolves the identical corpus the checker subprocess would find from
 * the same `cwd`, including the worktree → main-checkout fallback (SPEC M4)
 * this repo's dispatch protocol relies on. This is a SHARED resolution
 * helper, never the checker under test, so using it does not reopen the
 * circularity AC-BFI-10 closes.
 *
 * Reads a `.backup` SNAPSHOT, never the live file directly — several sibling
 * agents may hold the real corpus open/writing concurrently under this
 * repo's worktree-dispatch protocol (same discipline as
 * `gate-feeding-fresh-install.test.ts`), so a live read risks `SQLITE_BUSY`.
 *
 * @param repoRoot - Directory to resolve the corpus from (mirrors the
 *   checker subprocess's `cwd`)
 * @returns The set of live spec slugs with NO non-empty `extra.code_anchors`
 * @throws when no real corpus can be resolved from `repoRoot`, the scan
 *   comes back empty, or the `sqlite3` CLI is unavailable/fails — never
 *   silently returns an empty set, which would make every comparison below
 *   vacuously "equal"
 */

/**
 * The witness's OWN per-row anchored classification (a non-empty
 * `extra.code_anchors` array) — extracted out of {@link measureUnanchoredLiveSpecSlugsIndependently}'s
 * loop body so BOTH that function AND the AC-BFI-14 differential table below
 * call this ONE local copy, instead of the differential table re-typing a
 * second textual copy that could silently go stale relative to the real
 * witness. This is still NOT `flows/drift-flow.ts::isSpecAnchored` — it is a
 * SEPARATE, locally-owned function, on a completely different code path (a
 * raw `extra` JSON value read off a SQL row, never a `DocRecord`, never
 * `createApp`/`corpusService`) — that separateness is exactly what AC-BFI-10
 * bought, and AC-BFI-14 explicitly refuses to collapse it into the shared
 * predicate (see this file's header and the `anchored-predicate-ssot` suite
 * below).
 *
 * @param extra - A spec row's already-JSON-parsed `extra` column (or `{}` if
 *   the column was null/unparseable — mirrors the caller's own fallback)
 * @returns `true` iff `extra["code_anchors"]` is a non-empty array
 */
function classifyExtraAsAnchoredByWitness(extra: unknown): boolean {
  const codeAnchors = (extra as Record<string, unknown>)["code_anchors"];
  return Array.isArray(codeAnchors) && codeAnchors.length > 0;
}

function measureUnanchoredLiveSpecSlugsIndependently(repoRoot: string): Set<string> {
  const resolved = resolveCorpus(repoRoot);
  if (resolved === undefined || resolved.provenance === "undetermined") {
    throw new Error(
      `AC-BFI-10 independent measurement: could not resolve a real corpus db from ${repoRoot} ` +
        `(provenance: ${resolved?.provenance ?? "none"}) — refusing to report an empty set as a false agreement.`,
    );
  }
  const repoDbPath = resolved.path;

  const snapshotDir = mkdtempSync(join(tmpdir(), "lore-anchor-cov-independent-"));
  const snapshotDbPath = join(snapshotDir, "snapshot.db");
  try {
    // SQLite Online Backup API via the sqlite3 CLI — same discipline as
    // gate-feeding-fresh-install.test.ts's `.backup`: the ORIGINAL file is
    // opened for reading only; everything downstream operates on the snapshot.
    execFileSync("sqlite3", [repoDbPath, `.backup ${snapshotDbPath}`], { encoding: "utf8" });

    const raw = execFileSync(
      "sqlite3",
      ["-json", snapshotDbPath, "SELECT slug, extra FROM docs WHERE type='spec' AND deleted_at IS NULL;"],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
    const rows = JSON.parse(raw.trim().length > 0 ? raw : "[]") as Array<{ slug: string; extra: string | null }>;
    if (rows.length === 0) {
      throw new Error("AC-BFI-10 independent measurement: scanned 0 live specs — a real corpus cannot be this empty.");
    }

    const unanchored = new Set<string>();
    for (const row of rows) {
      let extra: unknown = {};
      if (row.extra !== null && row.extra !== undefined) {
        try {
          extra = JSON.parse(row.extra);
        } catch {
          extra = {};
        }
      }
      if (!classifyExtraAsAnchoredByWitness(extra)) unanchored.add(row.slug);
    }
    return unanchored;
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}

/** Set-difference in both directions, sorted, for a deterministic failure message. */
function diffSlugSets(
  measured: ReadonlySet<string>,
  ledgerSlugs: ReadonlySet<string>,
): { readonly missingFromLedger: readonly string[]; readonly extraInLedger: readonly string[] } {
  return {
    missingFromLedger: [...measured].filter((slug) => !ledgerSlugs.has(slug)).sort(),
    extraInLedger: [...ledgerSlugs].filter((slug) => !measured.has(slug)).sort(),
  };
}

/**
 * AC-BFI-12's fix: the ONE assertion path both the HAPPY case and its declared
 * falsifier case call. Before this existed, the HAPPY case wrote its own
 * `expect(...).toEqual([])` pair and the "RED PAIRED (declared falsifier)"
 * case below wrote a second, independent `expect(diff.missingFromLedger).
 * toContain(...)` — two different assertions over the same `diffSlugSets`
 * output. Deleting or weakening the HAPPY case's pair left the falsifier
 * case's own, unrelated `toContain` fully intact, so NOTHING reddened
 * (measured 2026-08-19: both stayed green). Routing both call sites through
 * this one function means a mutation that weakens the check here breaks BOTH
 * — the falsifier case below asserts this function THROWS on a mismatch, so
 * turning it into a no-op is caught there, not just silently accepted by the
 * HAPPY case it would otherwise only weaken alone.
 *
 * Throws vitest's own AssertionError (via `expect(...).toEqual([])`) the
 * instant either half of the slug-set diff is non-empty, naming the slugs.
 */
function assertLedgerSlugSetMatchesMeasured(measured: ReadonlySet<string>, ledgerSlugs: ReadonlySet<string>): void {
  const diff = diffSlugSets(measured, ledgerSlugs);
  expect(
    diff.missingFromLedger,
    `unanchored live spec(s) measured independently of the checker but ABSENT from the ledger's slug set: ${JSON.stringify(diff.missingFromLedger)}`,
  ).toEqual([]);
  expect(
    diff.extraInLedger,
    `ledger row(s) naming slug(s) NOT independently measured as unanchored live specs: ${JSON.stringify(diff.extraInLedger)}`,
  ).toEqual([]);
}

describe("AC-BFI-10: ledger membership is asserted as a slug set, independently of the checker", () => {
  it(
    "HAPPY: the independently-measured unanchored slug SET equals the fixture ledger's slug SET — computed WITHOUT reading the checker's stdout or exit code",
    () => {
      const independentlyMeasured = measureUnanchoredLiveSpecSlugsIndependently(fx.cwd);
      const shipped = fixtureLedger();
      const shippedSlugs = new Set(shipped.entries.map((entry) => entry.slug));

      // Same function the falsifier case below calls — see its definition
      // for why this sharing is the point (AC-BFI-12).
      assertLedgerSlugSetMatchesMeasured(independentlyMeasured, shippedSlugs);
    },
    60000,
  );

  it(
    "RED PAIRED (declared falsifier): overwriting one ledger row's slug with ANOTHER already-ledgered slug — row COUNT unchanged, so the cardinality assertion alone would stay green — makes the SHARED assertion function throw, NAMING the omitted slug",
    () => {
      // The exact falsifier this AC's oracle declares: both rows already exist in
      // the fixture ledger, so replacing one slug with the other changes NOTHING
      // about `entries.length` — only membership (one slug duplicated, one omitted).
      const shipped = fixtureLedger();
      const VICTIM_OMITTED = (shipped.entries[0] as LedgerEntry).slug;
      const VICTIM_DUPLICATED = (shipped.entries[1] as LedgerEntry).slug;
      const rowToMutate = shipped.entries.find((entry) => entry.slug === VICTIM_OMITTED);
      const otherRow = shipped.entries.find((entry) => entry.slug === VICTIM_DUPLICATED);
      expect(rowToMutate, `declared falsifier requires ${VICTIM_OMITTED} to already be a ledger row`).toBeDefined();
      expect(otherRow, `declared falsifier requires ${VICTIM_DUPLICATED} to already be a ledger row`).toBeDefined();

      const independentlyMeasured = measureUnanchoredLiveSpecSlugsIndependently(fx.cwd);

      // Preconditions ONLY on the two slugs this test mutates — never a full-corpus
      // equality check here. That global check is the HAPPY case above; coupling
      // THIS causal test to the entire corpus being ledger-clean would make it fail
      // for a reason that has nothing to do with the declared falsifier whenever
      // some OTHER live spec has drifted (a real, previously-measured condition:
      // `spec-corpus-truthfulness-a-verdict-must-carry-the-state-it` landed with no
      // anchor and no ledger row on 2026-08-17. DISPOSITIONED 2026-08-18 in commit
      // 2c606027 — NOT by adding a code_anchor (it still has none: `lore get
      // spec-corpus-truthfulness-a-verdict-must-carry-the-state-it --json` shows
      // `extra.code_anchors` absent/empty), but by adding a `cohort: "debt"` row for
      // it in scripts/anchor-coverage-ledger.json, which is why it independently
      // measures as unanchored above yet no longer diverges from the ledger).
      expect(
        independentlyMeasured.has(VICTIM_OMITTED),
        `${VICTIM_OMITTED} must independently measure as unanchored for this falsifier to mean anything`,
      ).toBe(true);
      expect(
        independentlyMeasured.has(VICTIM_DUPLICATED),
        `${VICTIM_DUPLICATED} must independently measure as unanchored for this falsifier to mean anything`,
      ).toBe(true);

      const mutated = copyLedger(shipped);
      (mutated.entries.find((entry) => entry.slug === VICTIM_OMITTED) as LedgerEntry).slug = VICTIM_DUPLICATED;

      // The row COUNT is unchanged — this is exactly what leaves the OLD
      // assertion (`shipped.entries.length === unanchored`) blind to this
      // mutation: it only ever compared cardinality.
      expect(mutated.entries.length).toBe(shipped.entries.length);

      const mutatedSlugs = new Set(mutated.entries.map((entry) => entry.slug));
      expect(mutatedSlugs.has(VICTIM_OMITTED), `${VICTIM_OMITTED}'s row was overwritten, not duplicated`).toBe(false);

      // RED via the SAME assertion path the HAPPY case above calls (AC-BFI-12):
      // VICTIM_OMITTED no longer appears anywhere in the mutated ledger's slug
      // set (its row was OVERWRITTEN, not duplicated) even though the corpus
      // still measures it as unanchored, so the shared function must throw,
      // naming VICTIM_OMITTED. If a future edit weakens or deletes the
      // function's internal `expect` calls, this assertion is what catches
      // it — not a second, independently-written check.
      expect(() => assertLedgerSlugSetMatchesMeasured(independentlyMeasured, mutatedSlugs)).toThrow(
        new RegExp(VICTIM_OMITTED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    },
    60000,
  );
});

// ─── AC-BFI-14: one production definition of the anchored predicate, pinned ─
// to the independent witness by a differential table ───────────────────────
//
// Two halves, deliberately not collapsed into each other (see this file's own
// AC-BFI-10 header and drift-flow.ts::isSpecAnchored's header):
//   (1) the anchored-predicate (a non-empty extra.code_anchors array) now has
//       exactly ONE production construction site repo-wide
//       (flows/drift-flow.ts::isSpecAnchored) — asserted by a STRUCTURAL scan
//       over packages/** and scripts/**, never an enumerated file list, so a
//       fourth copy in a file nobody named still goes red. Measured 2026-08-21
//       while building this suite: an UNDOCUMENTED third production copy
//       existed in commands/status.ts::collectCodeAnchorSpecMembers (added by
//       task-register-an-anchor-coverage-enumerator-on-the-existing, AC-BFI-4,
//       and missed by this AC's own "the three copies" table) — collapsed onto
//       the same import as part of landing this suite, which is exactly the
//       scan's designed discriminating power working as intended, not a
//       synthetic drill.
//   (2) measureUnanchoredLiveSpecSlugsIndependently (AC-BFI-10's witness) KEEPS
//       its own implementation — importing the shared predicate into it is
//       explicitly refused — and is instead bound to the shared predicate by a
//       DIFFERENTIAL case table over a constructed fixture.

/**
 * Removes `//` and block comments, string-aware (a `//` inside a string
 * literal is not a comment) — same algorithm as
 * `terminal-resolution-ssot.test.ts`'s precedent scanner. Replaces removed
 * bytes with spaces so surviving characters keep their original line offsets.
 */
function stripCommentsForScan(source: string): string {
  const out = source.split("");
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];
    if (quote !== null) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        out[index] = " ";
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] !== "\n") out[index] = " ";
        index += 1;
      }
      if (index < source.length) {
        out[index] = " ";
        out[index + 1] = " ";
        index += 2;
      }
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/**
 * Every `.ts`/`.tsx` file under `dir`, skipping `node_modules`/`dist`/
 * generated files AND every test file/tests directory. The Half-1 scan is
 * deliberately scoped to EXECUTABLE (production) code: Half 2 above keeps
 * measureUnanchoredLiveSpecSlugsIndependently's own copy of this idiom on
 * purpose, so scanning test files here would make the two halves of this AC
 * directly contradict each other.
 */
function collectExecutableSourceFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      if (entry.name === "tests" || entry.name === "test") continue;
      collectExecutableSourceFiles(full, into);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".gen.ts")) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx") || entry.name.endsWith(".bun.test.ts")) continue;
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) into.push(full);
  }
  return into;
}

/** The idiom itself: `Array.isArray(X) && X.length > 0` for one identifier `X`. */
const ANCHORED_PREDICATE_IDIOM_RE = /Array\.isArray\((\w+)\)\s*&&\s*\1\.length\s*>\s*0/g;
/**
 * The SECOND, INDEPENDENT condition the idiom match must be paired with
 * (per the marker-census-over-matches lesson): a `code_anchors` token nearby,
 * as a quoted string (bracket-access form, e.g. `extra["code_anchors"]`) or a
 * dotted property access. Without this, the scan would also flag the
 * IDENTICAL idiom guarding unrelated fields elsewhere in this repo
 * (`corpus-service.ts`'s `phasesBefore`/`evidenceBefore`/`acScope` all use
 * `Array.isArray(x) && x.length > 0` for THEIR OWN fields) — see the
 * REGRESSION case below for a live demonstration.
 */
const CODE_ANCHORS_TOKEN_RE = /"code_anchors"|'code_anchors'|`code_anchors`|\.code_anchors\b/;

/**
 * Finds every "construction of the non-empty-array test on code_anchors" in
 * `source`: the idiom above, PAIRED with a `code_anchors` token within 400
 * characters immediately before or 200 after the match (the extraction
 * statement always precedes the check in every real site measured — see the
 * module comment above). Comments are stripped first, so a doc block quoting
 * both halves of the idiom is not a construction site (REGRESSION case below).
 *
 * @returns One 1-based line number per matched construction site.
 */
function findAnchoredPredicateConstructionSites(source: string): number[] {
  const stripped = stripCommentsForScan(source);
  const lines: number[] = [];
  let match: RegExpExecArray | null;
  ANCHORED_PREDICATE_IDIOM_RE.lastIndex = 0;
  while ((match = ANCHORED_PREDICATE_IDIOM_RE.exec(stripped)) !== null) {
    const idx = match.index;
    const before = stripped.slice(Math.max(0, idx - 400), idx);
    const after = stripped.slice(idx, idx + 200);
    if (CODE_ANCHORS_TOKEN_RE.test(before) || CODE_ANCHORS_TOKEN_RE.test(after)) {
      lines.push(stripped.slice(0, idx).split("\n").length);
    }
  }
  return lines;
}

/**
 * Fails loud if the 5-levels-up REPO_ROOT arithmetic is wrong — an EMPTY scan
 * universe is the same shape as a clean one, so the universe's own root is
 * asserted rather than assumed (root CLAUDE.md, seventh false-oracle vector).
 */
function assertScanRepoRoot(): void {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { name?: string };
  expect(pkg.name).toBe("lore-workspace");
}

describe("anchored-predicate-ssot: AC-BFI-14 half 1 — exactly one production definition of the anchored predicate", () => {
  it("anchored-predicate-ssot: exactly one construction site exists under packages/** and scripts/**, and it is flows/drift-flow.ts", () => {
    assertScanRepoRoot();

    const files: string[] = [];
    collectExecutableSourceFiles(PACKAGES_DIR, files);
    collectExecutableSourceFiles(SCRIPTS_DIR, files);
    // Positive trace of execution — an empty universe would otherwise pass
    // this test vacuously.
    expect(files.length).toBeGreaterThan(100);

    const sitesByFile = new Map<string, number>();
    for (const file of files) {
      const lines = findAnchoredPredicateConstructionSites(readFileSync(file, "utf8"));
      if (lines.length > 0) {
        sitesByFile.set(relative(REPO_ROOT, file).split(sep).join(sep), lines.length);
      }
    }

    expect(
      [...sitesByFile.entries()].map(([file, count]) => `${file} (${count})`),
      "exactly one file may construct the anchored (non-empty extra.code_anchors array) predicate — " +
        "an enumerated file list is not a substitute for this scan, and a fourth copy in an unnamed " +
        "file must be caught right here",
    ).toEqual([`${SHARED_PREDICATE_HOME_REL} (1)`]);
  });

  it("anchored-predicate-ssot: the scanner FIRES on a synthetic second copy (make-it-red control, in-memory only — this file never contains a real second copy)", () => {
    const synthetic = [
      "function isAnchoredCopy(spec: { extra: Record<string, unknown> }): boolean {",
      '  const raw = spec.extra["code_anchors"];',
      "  return Array.isArray(raw) && raw.length > 0;",
      "}",
    ].join("\n");
    expect(findAnchoredPredicateConstructionSites(synthetic).length).toBe(1);
  });

  it("anchored-predicate-ssot: the SAME idiom guarding an UNRELATED field is NOT flagged (regression: the second condition prevents over-matching)", () => {
    // The identical idiom this repo already uses for ac_scope
    // (corpus-service.ts) and phasesBefore/evidenceBefore — none of these are
    // copies of the anchored predicate, and the scan must not treat them as
    // such just because they share a shape.
    const unrelated = [
      'const acScope = spec.extra["ac_scope"];',
      "if (Array.isArray(acScope) && acScope.length > 0) {",
      "  // ...",
      "}",
    ].join("\n");
    expect(findAnchoredPredicateConstructionSites(unrelated).length).toBe(0);
  });

  it("anchored-predicate-ssot: a doc-comment quoting both halves of the idiom is NOT a construction site (regression: comments/prose are stripped first)", () => {
    const commentOnly = [
      "/**",
      ' * mirrors `Array.isArray(raw) && raw.length > 0` on `extra["code_anchors"]`',
      " * — documented here, never executed.",
      " */",
      "const x = 1;",
    ].join("\n");
    expect(findAnchoredPredicateConstructionSites(commentOnly).length).toBe(0);
  });
});

// ─── AC-BFI-14 half 2: the differential case table ──────────────────────────

interface AnchoredPredicateFixtureRow {
  readonly name: string;
  readonly extra: Record<string, unknown>;
  readonly deletedAt?: string;
}

/**
 * The five constructed boundary rows AC-BFI-14 names verbatim — never the live
 * corpus. `deletedAt` on the fifth row exercises a dimension NEITHER
 * implementation examines (both classify purely off `extra.code_anchors`), so
 * agreement on that row proves neither implementation silently starts
 * conflating "soft-deleted" with "unanchored".
 */
const ANCHORED_PREDICATE_FIXTURE_ROWS: readonly AnchoredPredicateFixtureRow[] = [
  { name: "code_anchors absent", extra: {} },
  { name: "code_anchors: [] (empty array)", extra: { code_anchors: [] } },
  { name: "code_anchors: a non-array value", extra: { code_anchors: "src/a.ts" } },
  { name: "code_anchors: a non-empty array", extra: { code_anchors: ["src/a.ts"] } },
  {
    name: "code_anchors: a non-empty array, AND deleted_at set",
    extra: { code_anchors: ["src/a.ts"] },
    deletedAt: "2026-08-20T00:00:00.000Z",
  },
];

/**
 * The ONE shared assertion path for every row (mirrors AC-BFI-12's
 * `assertLedgerSlugSetMatchesMeasured` discipline: one function both the
 * happy suite and a future falsifier call, so weakening it cannot leave one
 * caller green and the other honest). Compares
 * {@link classifyExtraAsAnchoredByWitness} (the witness's OWN, separately
 * maintained logic) against `flows/drift-flow.ts::isSpecAnchored` (the ONE
 * shared production predicate) on the SAME row, naming the row on
 * disagreement.
 */
function assertWitnessAgreesWithSharedPredicate(row: AnchoredPredicateFixtureRow): void {
  const witnessResult = classifyExtraAsAnchoredByWitness(row.extra);
  const sharedResult = isSpecAnchored({ extra: row.extra, deleted_at: row.deletedAt ?? null } as DocRecord);
  expect(
    witnessResult,
    `case "${row.name}": witness classified anchored=${witnessResult} but the shared isSpecAnchored classified anchored=${sharedResult}`,
  ).toBe(sharedResult);
}

describe("anchored-predicate-ssot: AC-BFI-14 half 2 — the independent witness agrees with the shared predicate on every boundary case", () => {
  for (const row of ANCHORED_PREDICATE_FIXTURE_ROWS) {
    it(`anchored-predicate-ssot: HAPPY — witness and shared predicate agree on "${row.name}"`, () => {
      assertWitnessAgreesWithSharedPredicate(row);
    });
  }

  it("anchored-predicate-ssot: all five rows classify as expected (sanity on the fixture itself, not just cross-agreement)", () => {
    const expected = [false, false, false, true, true];
    ANCHORED_PREDICATE_FIXTURE_ROWS.forEach((row, index) => {
      expect(classifyExtraAsAnchoredByWitness(row.extra), `witness, case "${row.name}"`).toBe(expected[index]);
      expect(
        isSpecAnchored({ extra: row.extra, deleted_at: row.deletedAt ?? null } as DocRecord),
        `shared predicate, case "${row.name}"`,
      ).toBe(expected[index]);
    });
  });
});
