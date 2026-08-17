/**
 * Reverse-direction arming suite for `scripts/check-anchor-coverage.ts` — AC-BFI-7
 * (a ledger row cannot outlive its debt) of
 * `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor`, i.e.
 * `adr-a-newly-armed-structural-oracle-enforces-from-a-baseline` criterion 3.
 *
 * THE FAILURE BEING EXCLUDED, stated precisely: a checker that validates only the
 * FORWARD direction (`unanchored ⇒ ledgered`) exits 0 on a ledger row whose spec has
 * since declared `code_anchors`, because that spec is no longer in the unanchored set
 * and so is never looked at again. Its row then silently becomes a suppression entry.
 * A bare `exitCode === 1` assertion cannot prove the reverse direction is what fired,
 * so `REGRESSION (the excluded failure, made decidable)` below additionally asserts
 * that the FORWARD direction is fully satisfied in that same state — no spec is
 * missing a disposition — which leaves the reverse check as the only possible source
 * of the failure.
 *
 * Structure, exit-code discipline and the ⛔ never-write-to-the-repo-corpus rule are
 * identical to `anchor-coverage-ratchet.test.ts` — see that file's header for the
 * subprocess rationale (the checker transitively imports `bun:sqlite` and therefore
 * cannot be imported into a vitest worker), for why `RunResult.exitCode` reports `-1`
 * rather than `1` on a signal kill, and for why the helper block below is duplicated
 * rather than shared (this task's declared file anchors are exactly four paths; a
 * fifth shared-helper module is outside them).
 *
 * @spec_ref spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor AC-BFI-7
 * @spec_ref adr-a-newly-armed-structural-oracle-enforces-from-a-baseline criterion 3
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Paths ──────────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL(".", import.meta.url));
/** `packages/lore/tests/unit/scripts` → repo root is five levels up. */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const CHECKER_SCRIPT = join(REPO_ROOT, "scripts", "check-anchor-coverage.ts");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:anchor-coverage-stale-test";
/** See `anchor-coverage-ratchet.test.ts` for why this literal is duplicated and how it stays pinned. */
const LEDGER_RELATIVE_PATH = "scripts/anchor-coverage-ledger.json";

/** A repo-relative path that really exists, so `lore status --check-drift` would not report the fixture anchor as drift. */
const FIXTURE_ANCHOR = "packages/lore/src/index.ts";

// ─── Ledger shape ───────────────────────────────────────────────────────────

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
  /** The child's real exit code, or `-1` when killed by a signal (never `1`). */
  readonly exitCode: number;
  readonly combined: string;
}

function spawnBun(args: string[], cwd: string, env: NodeJS.ProcessEnv): RunResult {
  const result = spawnSync("bun", args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, env });
  if (result.error !== undefined) {
    throw new Error(`spawn failed: bun ${args.join(" ")} — ${result.error.message}`);
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { stdout, stderr, exitCode: result.status ?? -1, combined: stdout + stderr };
}

function runLore(args: string[], cwd: string): RunResult {
  return spawnBun(["run", LORE_ENTRY, ...args], cwd, { ...process.env, CLAUDECODE: "1" });
}

function runChecker(cwd: string, ledgerRoot?: string): RunResult {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LORE_ANCHOR_COVERAGE_REPO_ROOT;
  if (ledgerRoot !== undefined) env.LORE_ANCHOR_COVERAGE_REPO_ROOT = ledgerRoot;
  return spawnBun(["run", CHECKER_SCRIPT], cwd, env);
}

function initLedgerRoot(file: LedgerFile): string {
  const root = mkdtempSync(join(tmpdir(), "lore-anchor-stale-ledger-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, LEDGER_RELATIVE_PATH), JSON.stringify(file, null, 2), "utf8");
  return root;
}

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

function copyLedger(file: LedgerFile): LedgerFile {
  return JSON.parse(JSON.stringify(file)) as LedgerFile;
}

// ─── Fixture corpus ─────────────────────────────────────────────────────────

const FIXTURE_SPEC_CONTENT =
  "## Overview/Goal\n\nFixture spec for check-anchor-coverage's stale-exemption test.\n\n" +
  "## Scope\n\nOne throwaway spec that starts unanchored and later declares a code anchor.\n\n" +
  "## Acceptance Criteria\n\n- Once it declares an anchor, its ledger row must fail loud.\n";

const FIXTURE_REASON =
  "Throwaway fixture spec created by the anchor-coverage stale-exemption suite; unanchored at creation.";

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

function addCodeAnchor(cwd: string, specId: string, anchor: string): void {
  const result = runLore(["anchor", "add", specId, anchor, "--json"], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture setup: anchor add failed (exit ${result.exitCode}): ${result.combined}`);
  }
}

// ─── AC-BFI-7 ───────────────────────────────────────────────────────────────

describe("check-anchor-coverage: a ledger row cannot outlive its debt (AC-BFI-7)", () => {
  it(
    "RED PAIRED: declaring code_anchors on a ledgered spec WITHOUT removing its row exits EXACTLY 1 naming that slug; removing the row makes the IDENTICAL run exit EXACTLY 0",
    () => {
      const cwd = initFixtureCorpus("lore-anchor-stale-");
      try {
        const prd = createDoc(cwd, "prd", "Anchor coverage stale fixture root", "Fixture prd body.", []);
        const spec = createDoc(cwd, "spec", "Anchor coverage stale fixture spec", FIXTURE_SPEC_CONTENT, [
          "--parent",
          prd.id,
        ]);
        const ledgered: LedgerFile = { entries: [{ slug: spec.slug, cohort: "debt", reason: FIXTURE_REASON }] };

        // Control: while the spec is genuinely unanchored, the row is legitimate.
        const beforeAnchoring = runCheckerWithLedger(cwd, copyLedger(ledgered));
        expect(beforeAnchoring.exitCode).toBe(0);

        // The debt is now paid — the spec declares a real code anchor.
        addCodeAnchor(cwd, spec.id, FIXTURE_ANCHOR);

        // RED: the row outlived the debt it described.
        const red = runCheckerWithLedger(cwd, copyLedger(ledgered));
        expect(red.exitCode).toBe(1);
        expect(red.combined).toContain(spec.slug);
        expect(red.combined).toContain("now declares code_anchors");

        // GREEN: the IDENTICAL run with the row retired.
        const green = runCheckerWithLedger(cwd, { entries: [] });
        expect(green.exitCode).toBe(0);
        expect(green.combined).not.toContain("now declares code_anchors");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    120000,
  );

  it(
    "REGRESSION (the excluded failure, made decidable): in the stale state the FORWARD direction `unanchored ⇒ ledgered` is fully satisfied, so a forward-only checker would exit 0 — the exit 1 can only come from the reverse check",
    () => {
      const cwd = initFixtureCorpus("lore-anchor-stale-fwd-");
      try {
        const prd = createDoc(cwd, "prd", "Anchor coverage forward-only fixture root", "Fixture prd body.", []);
        const anchoredSpec = createDoc(cwd, "spec", "Anchor coverage forward-only anchored spec", FIXTURE_SPEC_CONTENT, [
          "--parent",
          prd.id,
        ]);
        const unanchoredSpec = createDoc(
          cwd,
          "spec",
          "Anchor coverage forward-only unanchored spec",
          FIXTURE_SPEC_CONTENT,
          ["--parent", prd.id],
        );
        addCodeAnchor(cwd, anchoredSpec.id, FIXTURE_ANCHOR);

        // Both specs carry a row. The unanchored one legitimately needs its row (so the
        // forward direction is satisfied); the anchored one's row is pure debt-outliving.
        const result = runCheckerWithLedger(cwd, {
          entries: [
            { slug: anchoredSpec.slug, cohort: "debt", reason: FIXTURE_REASON },
            { slug: unanchoredSpec.slug, cohort: "debt", reason: FIXTURE_REASON },
          ],
        });

        expect(result.exitCode).toBe(1);
        // The reverse direction fired, and named the offender.
        expect(result.combined).toContain("now declares code_anchors");
        expect(result.combined).toContain(anchoredSpec.slug);
        // ...while the forward direction found nothing at all — the discrimination that
        // makes "a forward-only checker would have exited 0 here" a measured claim
        // rather than a narrative one.
        expect(result.combined).not.toContain("no ledger disposition");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    120000,
  );

  it(
    "NEGATIVE: a ledger row naming a slug that is not a live spec at all exits EXACTLY 1 naming it — a typo'd or deleted-spec row is never silently ignored",
    () => {
      const cwd = initFixtureCorpus("lore-anchor-stale-unknown-");
      try {
        const prd = createDoc(cwd, "prd", "Anchor coverage unknown-slug fixture root", "Fixture prd body.", []);
        const spec = createDoc(cwd, "spec", "Anchor coverage unknown-slug fixture spec", FIXTURE_SPEC_CONTENT, [
          "--parent",
          prd.id,
        ]);
        const ghost = "spec-this-slug-was-never-a-live-spec-in-this-corpus";

        const red = runCheckerWithLedger(cwd, {
          entries: [
            { slug: spec.slug, cohort: "debt", reason: FIXTURE_REASON },
            { slug: ghost, cohort: "debt", reason: FIXTURE_REASON },
          ],
        });
        expect(red.exitCode).toBe(1);
        expect(red.combined).toContain(ghost);
        expect(red.combined).toContain("not a live spec");

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
});

// ─── AC-BFI-7 against the REAL corpus + the SHIPPED ledger ──────────────────
//
// The fixture cases above prove the reverse direction fires. These two prove it is
// armed on the surface that actually ships: this repo's own corpus read through the
// shipped ledger. ⛔ READ-ONLY — the checker's only corpus access is one
// `listFull({type:"spec"})`; every mutation happens to a COPY of the ledger in a
// throwaway root.

describe("check-anchor-coverage: the reverse direction is armed against the real corpus and the shipped ledger (AC-BFI-7)", () => {
  it(
    "RED PAIRED: injecting a row for a real spec that ALREADY declares code_anchors exits EXACTLY 1 naming it; the unmutated copy exits EXACTLY 0",
    () => {
      const shipped = loadShippedLedger();

      // Derive a genuinely anchored spec at runtime rather than hardcoding a live-corpus
      // slug (which would rot). Given the shipped ledger is complete — the paired green
      // below re-establishes that in this same run — every live spec NOT in the ledger is
      // anchored by construction. The census is taken with --include-invalid because
      // `lore list` silently omits invalidated docs by default, and a census wrong by a
      // hidden population is the exact defect this repo recorded.
      const listed = runLore(["list", "--type", "spec", "--include-invalid", "--json"], REPO_ROOT);
      expect(listed.exitCode).toBe(0);
      const docs = (JSON.parse(listed.stdout) as { data: { docs: { slug: string }[] } }).data.docs;
      const ledgeredSlugs = new Set(shipped.entries.map((e) => e.slug));
      const anchoredSlugs = docs.map((d) => d.slug).filter((slug) => !ledgeredSlugs.has(slug)).sort();
      expect(anchoredSlugs.length).toBeGreaterThan(0);
      const victim = anchoredSlugs[0] as string;

      const mutated = copyLedger(shipped);
      mutated.entries.push({
        slug: victim,
        cohort: "debt",
        reason: "Deliberately stale row injected by the anchor-coverage reverse-direction test.",
      });
      const red = runCheckerWithLedger(REPO_ROOT, mutated);
      expect(red.exitCode).toBe(1);
      expect(red.combined).toContain(victim);
      expect(red.combined).toContain("now declares code_anchors");

      const green = runCheckerWithLedger(REPO_ROOT, copyLedger(shipped));
      expect(green.exitCode).toBe(0);
      expect(green.combined).not.toContain("now declares code_anchors");
    },
    120000,
  );

  it(
    "RED PAIRED: injecting a row for a slug that does not exist in the real corpus exits EXACTLY 1 naming it; the unmutated copy exits EXACTLY 0",
    () => {
      const shipped = loadShippedLedger();
      const ghost = "spec-anchor-coverage-control-slug-that-does-not-exist";

      const mutated = copyLedger(shipped);
      mutated.entries.push({
        slug: ghost,
        cohort: "debt",
        reason: "Deliberately unresolvable row injected by the anchor-coverage reverse-direction test.",
      });
      const red = runCheckerWithLedger(REPO_ROOT, mutated);
      expect(red.exitCode).toBe(1);
      expect(red.combined).toContain(ghost);
      expect(red.combined).toContain("not a live spec");

      const green = runCheckerWithLedger(REPO_ROOT, copyLedger(shipped));
      expect(green.exitCode).toBe(0);
      expect(green.combined).not.toContain("not a live spec");
    },
    120000,
  );
});
