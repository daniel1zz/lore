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
 * ⛔ NEVER WRITES TO THE REPO'S OWN `.lore/`. Two fixture strategies, both
 * write-free against the live corpus:
 *   - REAL-CORPUS cases (AC-BFI-5) read this repo's corpus (the checker's only
 *     corpus access is ONE `listFull({type:"spec"})` read) and mutate a COPY of the
 *     shipped ledger in a `mkdtemp` throwaway "repo root", injected via
 *     `LORE_ANCHOR_COVERAGE_REPO_ROOT`. The shipped `scripts/anchor-coverage-ledger.json`
 *     is never edited.
 *   - FIXTURE-CORPUS cases (AC-BFI-6) build a throwaway `mkdtemp` + `lore init`
 *     corpus (project CLAUDE.md's canonical pattern) so a spec can be created and
 *     dispositioned deterministically, independent of live-corpus drift.
 *
 * Every RED here is a PAIRED transition — break it, then make the IDENTICAL run
 * green — because a bare exit-1 assertion cannot tell a fired ratchet from an
 * unrelated crash, and a bare exit-0 assertion cannot tell a working checker from
 * an inert one.
 *
 * @spec_ref spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor AC-BFI-5, AC-BFI-6
 * @spec_ref adr-a-newly-armed-structural-oracle-enforces-from-a-baseline (baseline + ledger shape)
 */

import { describe, it, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCorpus } from "../../../src/adapters/cli/corpus-resolution.js";

// ─── Paths ──────────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL(".", import.meta.url));
/** `packages/lore/tests/unit/scripts` → repo root is five levels up. */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const CHECKER_SCRIPT = join(REPO_ROOT, "scripts", "check-anchor-coverage.ts");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:anchor-coverage-fixture-test";

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

function loadShippedLedger(): LedgerFile {
  return JSON.parse(readFileSync(join(REPO_ROOT, LEDGER_RELATIVE_PATH), "utf8")) as LedgerFile;
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
  const result = runLore(["create", type, "--title", title, "--content", content, "--by", ACTOR, "--json", ...extraArgs], cwd);
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

describe("check-anchor-coverage: the shipped ledger dispositions every unanchored live spec (AC-BFI-5)", () => {
  it(
    "HAPPY: the shipped ledger's disposition set EQUALS the freshly measured unanchored live-spec set — exit EXACTLY 0 over a non-trivial, self-reported population",
    () => {
      const result = runChecker(REPO_ROOT);

      expect(result.exitCode).toBe(0);

      // Not a bare exit-0 assertion: a checker that scanned nothing (empty corpus,
      // silently-failed read) would also exit 0. Pin the self-reported census and
      // cross-check its arithmetic.
      const scanned = /scanned (\d+) live spec\(s\) — (\d+) anchored, (\d+) unanchored/.exec(result.combined);
      expect(scanned).not.toBeNull();
      const live = Number(scanned?.[1]);
      const anchored = Number(scanned?.[2]);
      const unanchored = Number(scanned?.[3]);
      expect(live).toBeGreaterThan(0);
      expect(anchored).toBeGreaterThan(0);
      expect(unanchored).toBeGreaterThan(0);
      expect(anchored + unanchored).toBe(live);

      // Set equality's cardinality half, measured against the shipped file. Exit 0
      // supplies the other half: a ledger row with no matching unanchored spec is a
      // stale/unknown finding, and an unanchored spec with no row is a missing one —
      // either would have exited 1.
      const shipped = loadShippedLedger();
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
      const green = runChecker(REPO_ROOT);
      expect(green.exitCode).toBe(0);
      const lastGreenLine = green.stdout.trimEnd().split("\n").at(-1);
      expect(lastGreenLine).toMatch(/^check-anchor-coverage: OK — .*0 finding\(s\)\.$/);

      const shipped = loadShippedLedger();
      const victim = [...shipped.entries].sort((a, b) => (a.slug < b.slug ? -1 : 1))[0] as LedgerEntry;
      const mutated = copyLedger(shipped);
      mutated.entries = mutated.entries.filter((e) => e.slug !== victim.slug);
      const red = runCheckerWithLedger(REPO_ROOT, mutated);
      expect(red.exitCode).toBe(1);
      const lastRedLine = red.stderr.trimEnd().split("\n").at(-1);
      expect(lastRedLine).toMatch(/^check-anchor-coverage: FAILED — 1 finding\(s\) in 1 class\(es\): missing_disposition\.$/);
    },
    60000,
  );

  it(
    "RED (a) PAIRED: deleting one shipped ledger row makes the IDENTICAL run exit EXACTLY 1 and NAME that slug; restoring the row exits EXACTLY 0",
    () => {
      const shipped = loadShippedLedger();
      expect(shipped.entries.length).toBeGreaterThan(0);

      // Deterministic victim: lexicographically smallest slug, so a re-run picks the
      // same row regardless of file ordering.
      const victim = [...shipped.entries].sort((a, b) => (a.slug < b.slug ? -1 : 1))[0] as LedgerEntry;

      const withRowRemoved = copyLedger(shipped);
      withRowRemoved.entries = withRowRemoved.entries.filter((e) => e.slug !== victim.slug);
      const red = runCheckerWithLedger(REPO_ROOT, withRowRemoved);

      expect(red.exitCode).toBe(1);
      expect(red.combined).toContain(victim.slug);

      // The failure is the MISSING-disposition class specifically, not some unrelated finding.
      expect(red.combined).toContain("no ledger disposition");

      // The paired green: same corpus, same command, only the row restored.
      const green = runCheckerWithLedger(REPO_ROOT, copyLedger(shipped));
      expect(green.exitCode).toBe(0);
      expect(green.combined).not.toContain("no ledger disposition");
    },
    60000,
  );

  it(
    "RED (b) PAIRED: replacing one shipped ledger row's reason with 'tbd' makes the IDENTICAL run exit EXACTLY 1 and NAME that slug — the reason predicate is live, not decorative",
    () => {
      const shipped = loadShippedLedger();
      expect(shipped.entries.length).toBeGreaterThan(0);
      const victim = [...shipped.entries].sort((a, b) => (a.slug < b.slug ? -1 : 1))[0] as LedgerEntry;

      const withPlaceholderReason = copyLedger(shipped);
      const row = withPlaceholderReason.entries.find((e) => e.slug === victim.slug) as LedgerEntry;
      row.reason = "tbd";
      const red = runCheckerWithLedger(REPO_ROOT, withPlaceholderReason);

      expect(red.exitCode).toBe(1);
      expect(red.combined).toContain(victim.slug);
      expect(red.combined).toContain("unusable reason");

      const green = runCheckerWithLedger(REPO_ROOT, copyLedger(shipped));
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
      const shipped = loadShippedLedger();
      const victim = [...shipped.entries].sort((a, b) => (a.slug < b.slug ? -1 : 1))[0] as LedgerEntry;

      const mutated = copyLedger(shipped);
      (mutated.entries.find((e) => e.slug === victim.slug) as LedgerEntry).reason = reason;
      const result = runCheckerWithLedger(REPO_ROOT, mutated);

      expect(result.exitCode).toBe(1);
      expect(result.combined).toContain(victim.slug);
      expect(result.combined).toContain("unusable reason");
    },
    60000,
  );

  it(
    "BOUNDARY: a reason of EXACTLY 20 characters is accepted — the floor is >= 20, not > 20",
    () => {
      const shipped = loadShippedLedger();
      const victim = [...shipped.entries].sort((a, b) => (a.slug < b.slug ? -1 : 1))[0] as LedgerEntry;

      const mutated = copyLedger(shipped);
      const twentyChars = "12345678901234567890";
      expect(twentyChars.length).toBe(20);
      (mutated.entries.find((e) => e.slug === victim.slug) as LedgerEntry).reason = twentyChars;

      const result = runCheckerWithLedger(REPO_ROOT, mutated);
      expect(result.exitCode).toBe(0);
    },
    60000,
  );

  it(
    "ERROR: a missing ledger file exits EXACTLY 2 — the scan-failed class, never conflated with the repo-invariant 1 the ratchet pins",
    () => {
      const emptyRoot = mkdtempSync(join(tmpdir(), "lore-anchor-cov-noledger-"));
      try {
        const result = runChecker(REPO_ROOT, emptyRoot);
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
          "--parent",
          prd.id,
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
          "--parent",
          prd.id,
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
          "--parent",
          prd.id,
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
      const codeAnchors = (extra as Record<string, unknown>)["code_anchors"];
      const isAnchored = Array.isArray(codeAnchors) && codeAnchors.length > 0;
      if (!isAnchored) unanchored.add(row.slug);
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

describe("AC-BFI-10: ledger membership is asserted as a slug set, independently of the checker", () => {
  it(
    "HAPPY: the independently-measured unanchored slug SET equals the shipped ledger's slug SET — computed WITHOUT reading the checker's stdout or exit code",
    () => {
      const independentlyMeasured = measureUnanchoredLiveSpecSlugsIndependently(REPO_ROOT);
      const shipped = loadShippedLedger();
      const shippedSlugs = new Set(shipped.entries.map((entry) => entry.slug));

      const diff = diffSlugSets(independentlyMeasured, shippedSlugs);
      expect(
        diff.missingFromLedger,
        `unanchored live spec(s) measured independently of the checker but ABSENT from the ledger's slug set: ${JSON.stringify(diff.missingFromLedger)}`,
      ).toEqual([]);
      expect(
        diff.extraInLedger,
        `ledger row(s) naming slug(s) NOT independently measured as unanchored live specs: ${JSON.stringify(diff.extraInLedger)}`,
      ).toEqual([]);
    },
    60000,
  );

  it(
    "RED PAIRED (declared falsifier): overwriting one ledger row's slug with ANOTHER already-ledgered slug — row COUNT unchanged, so the cardinality assertion alone would stay green — makes the SET assertion fail, NAMING the omitted slug",
    () => {
      // The exact falsifier this AC's oracle declares: both rows already exist in
      // the shipped ledger, so replacing one slug with the other changes NOTHING
      // about `entries.length` — only membership (one slug duplicated, one omitted).
      const VICTIM_OMITTED = "spec-075-dashboard-adjudication-workbench-route-telemetry-prd";
      const VICTIM_DUPLICATED = "spec-077-dashboard-execution-read-surface-prd-21-f3";

      const shipped = loadShippedLedger();
      const rowToMutate = shipped.entries.find((entry) => entry.slug === VICTIM_OMITTED);
      const otherRow = shipped.entries.find((entry) => entry.slug === VICTIM_DUPLICATED);
      expect(rowToMutate, `declared falsifier requires ${VICTIM_OMITTED} to already be a ledger row`).toBeDefined();
      expect(otherRow, `declared falsifier requires ${VICTIM_DUPLICATED} to already be a ledger row`).toBeDefined();

      const independentlyMeasured = measureUnanchoredLiveSpecSlugsIndependently(REPO_ROOT);

      // Preconditions ONLY on the two slugs this test mutates — never a full-corpus
      // equality check here. That global check is the HAPPY case above; coupling
      // THIS causal test to the entire corpus being ledger-clean would make it fail
      // for a reason that has nothing to do with the declared falsifier whenever
      // some OTHER live spec has drifted (a real, previously-measured condition:
      // `spec-corpus-truthfulness-a-verdict-must-carry-the-state-it` landed with no
      // anchor and no ledger row on 2026-08-17, independently of this task).
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

      const diff = diffSlugSets(independentlyMeasured, mutatedSlugs);

      // RED: VICTIM_OMITTED no longer appears anywhere in the mutated ledger's
      // slug set (its row was OVERWRITTEN, not duplicated) even though the
      // corpus still measures it as unanchored — the set assertion must name it.
      expect(diff.missingFromLedger).toContain(VICTIM_OMITTED);
    },
    60000,
  );
});
