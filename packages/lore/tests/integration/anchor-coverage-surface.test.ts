/**
 * AC-BFI-4 oracle — `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor`.
 *
 * Anchor coverage must be READABLE, not merely countable: `lore status --json`
 * reports `code_anchor_specs` (the count of live specs declaring
 * `extra.code_anchors` — the anchor-coverage ratchet's own population) and
 * `lore status --enumerate code_anchor_specs` must return that count's MEMBER
 * LIST from the existing `COUNT_FIELD_ENUMERATORS` registry (the seam AC-FR-5
 * established), never a parallel bespoke coverage block.
 *
 * ⛔ Every assertion here is driven through the COMPILED `dist/lore` binary as a
 * real subprocess, reading its stdout. This is a USER-FACING SURFACE claim:
 * calling `collectCodeAnchorSpecMembers` in-process would attest a capability
 * the CLI may not actually expose, which is the exact "attested pass over an
 * unreachable surface" failure this repo has recorded twice. `assertFreshBinary`
 * (the same guard `cli-drift.bun.test.ts` and six sibling spawned-binary suites
 * use) fails loud when `dist/lore` is missing or older than the newest `.ts`
 * under `packages/{lore,core}/src`, so a stale binary can never read as a pass.
 * ⛔ This suite deliberately does NOT run `bun run build` itself: two test files
 * already rebuild `dist/lore` mid-suite, and `dist/lore` is what the machine's
 * global `lore` symlink resolves to — a third rebuilding file would widen a
 * known hazard. Run `bun run build` first; the guard tells you when you forgot.
 *
 * ⛔ SAFETY: never touches the repo's own `.lore/` corpus. Both fixtures are
 * `mkdtemp` + `lore init` throwaways with `HOME` redirected into the temp dir,
 * and the equality assertion is measured against a fixture whose anchored set
 * this file created — a real-corpus equality assertion would drift the moment a
 * concurrent session anchors a spec.
 *
 * ⛔ NON-VACUITY: the fixture deliberately anchors SOME specs and leaves others
 * unanchored, and the happy-path case pins the expected count to a nonzero
 * literal before comparing. `0 === 0` between a broken enumerator and a broken
 * counter is the shape of a false green, so the equality is never asserted
 * against an unknown number alone.
 *
 * The two declared REDs, both run before this suite went green:
 *   (a) report the count without registering an enumerator — `lore status
 *       --enumerate code_anchor_specs` exits 4 ("no enumerator registered for
 *       count field"), so every case below that spawns it fails.
 *   (b) register an enumerator returning a TRUNCATED list while the count field
 *       stays correct — the equality assertion fails NAMING BOTH NUMBERS.
 *
 * Six-dimension coverage:
 *   HAPPY:      an anchored fixture — enumerate exits EXACTLY 0 and its printed
 *               member count equals `--json`'s `code_anchor_specs`
 *   NEGATIVE:   an unregistered field name is still refused by name (exit 4) and
 *               the refusal now lists `code_anchor_specs` as known
 *   BOUNDARY:   a corpus where NO spec declares anchors — 0 members, still exit 0
 *               (an empty member list is a valid answer, never an error)
 *   ERROR:      exit codes asserted with `toBe(<n>)`, never "non-zero"
 *   STATE:      `lore anchor add` moves the count and the member list TOGETHER
 *   REGRESSION: the four pre-existing registered fields still enumerate, and the
 *               `--json` envelope agrees with the human render
 *
 * @spec_ref AC-BFI-4
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFreshBinary } from "./helpers/assert-fresh-binary.js";

/** Repo root: four levels up from `packages/lore/tests/integration/`. Asserted in `beforeAll`. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

/** The count field under test — the SPEC-045 D5 declared-anchor count this slice ratchets. */
const FIELD = "code_anchor_specs";

/** The registry entries that predate AC-BFI-4 — enumerating them must be undisturbed. */
const PRE_EXISTING_FIELDS = [
  "pass_unfalsified_count",
  "unredeemed_allow_missing_path_count",
  "capture_source_runner_count",
  "capture_source_self_report_count",
] as const;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns the compiled binary in `cwd`. `HOME` is redirected into the fixture so
 * no global lore config on the developer's machine can influence a run.
 */
function runLore(args: readonly string[], cwd: string): RunResult {
  const proc = spawnSync(LORE_BIN, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
  });
  if (proc.status === null) {
    throw new Error(`lore ${args.join(" ")} was killed by signal ${String(proc.signal)} — no exit code to assert`);
  }
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", exitCode: proc.status };
}

/** `lore status --json`'s `code_anchor_specs`, read off the real envelope. */
function statusCodeAnchorSpecs(cwd: string): number {
  const run = runLore(["status", "--json"], cwd);
  if (run.exitCode !== 0) throw new Error(`lore status --json failed (exit ${run.exitCode}): ${run.stderr}`);
  const envelope = JSON.parse(run.stdout) as { data: Record<string, unknown> };
  const value = envelope.data[FIELD];
  if (typeof value !== "number") {
    throw new Error(`lore status --json carries no numeric ${FIELD} (got ${JSON.stringify(value)})`);
  }
  return value;
}

/**
 * The member slugs the HUMAN render actually PRINTED — parsed from stdout, which
 * is all the criterion permits this oracle to read. Every member line is
 * `  - <slug>` (`commands/status.ts`'s `--enumerate` branch).
 */
function printedMembers(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("  - "))
    .map((line) => line.slice(4).trim());
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** Corpus with a MIX of anchored and unanchored specs — the equality fixture. */
let anchoredCorpus = "";
/** Corpus where no spec declares an anchor at all — the zero-member boundary. */
let bareCorpus = "";

/** Slugs of the specs seeded WITH `--code-anchor` in {@link anchoredCorpus}. */
let anchoredSlugs: string[] = [];
/** Slug of a seeded spec deliberately left with NO anchors — the STATE case anchors it later. */
let laterAnchoredSlug = "";

function initCorpus(dir: string): void {
  const run = runLore(["init"], dir);
  if (run.exitCode !== 0) throw new Error(`lore init failed (exit ${run.exitCode}): ${run.stderr}`);
}

/**
 * Disables the four service-layer gate checkpoints — the same append-never-
 * overwrite shape `cli-drift.bun.test.ts::disableAllGates` uses (a freshly
 * `init`ed `config.yaml` already declares a required top-level `project:` key,
 * and these fixtures' placeholder spec bodies would not satisfy `spec-create`).
 */
function disableAllGates(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

function parseSlug(stdout: string): string {
  return (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
}

function createPrd(dir: string, title: string): string {
  const run = runLore(
    ["create", "prd", "--title", title, "--no-ai", "--content", "## Overview\n\nFixture body.", "--json"],
    dir,
  );
  if (run.exitCode !== 0) throw new Error(`create prd failed (exit ${run.exitCode}): ${run.stderr}`);
  return parseSlug(run.stdout);
}

function createSpec(dir: string, prdSlug: string, title: string, codeAnchors: readonly string[]): string {
  const args = [
    "create",
    "spec",
    "--title",
    title,
    "--parent",
    prdSlug,
    "--kind",
    "feature",
    "--no-ai",
    "--content",
    "## Overview\n\nFixture body.",
    "--json",
  ];
  for (const anchor of codeAnchors) args.push("--code-anchor", anchor);
  const run = runLore(args, dir);
  if (run.exitCode !== 0) throw new Error(`create spec "${title}" failed (exit ${run.exitCode}): ${run.stderr}`);
  return parseSlug(run.stdout);
}

beforeAll(() => {
  if (!existsSync(join(REPO_ROOT, "scripts", "build.ts"))) {
    throw new Error(
      `anchor-coverage-surface.test.ts: REPO_ROOT resolved to "${REPO_ROOT}", which has no scripts/build.ts — ` +
        `the up-level count in this file's REPO_ROOT is wrong.`,
    );
  }
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);

  // ── anchored fixture: 3 specs WITH anchors, 2 without ──
  anchoredCorpus = mkdtempSync(join(tmpdir(), "lore-bfi4-anchored-"));
  initCorpus(anchoredCorpus);
  disableAllGates(anchoredCorpus);
  mkdirSync(join(anchoredCorpus, "src"), { recursive: true });
  for (const name of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
    writeFileSync(join(anchoredCorpus, "src", name), "export const Exported = 1;\n");
  }
  const anchoredPrd = createPrd(anchoredCorpus, "Anchor Coverage Fixture Root PRD");
  anchoredSlugs = [
    createSpec(anchoredCorpus, anchoredPrd, "ZzzCoverageAnchoredOne", ["src/a.ts#Exported"]),
    createSpec(anchoredCorpus, anchoredPrd, "ZzzCoverageAnchoredTwo", ["src/b.ts#Exported"]),
    createSpec(anchoredCorpus, anchoredPrd, "ZzzCoverageAnchoredThree", ["src/c.ts#Exported", "src/d.ts#Exported"]),
  ].sort();
  laterAnchoredSlug = createSpec(anchoredCorpus, anchoredPrd, "ZzzCoverageUnanchoredOne", []);
  createSpec(anchoredCorpus, anchoredPrd, "ZzzCoverageUnanchoredTwo", []);

  // ── boundary fixture: specs exist, none declares an anchor ──
  bareCorpus = mkdtempSync(join(tmpdir(), "lore-bfi4-bare-"));
  initCorpus(bareCorpus);
  disableAllGates(bareCorpus);
  const barePrd = createPrd(bareCorpus, "Anchor Coverage Bare Fixture Root PRD");
  createSpec(bareCorpus, barePrd, "ZzzBareSpecOne", []);
  createSpec(bareCorpus, barePrd, "ZzzBareSpecTwo", []);
}, 180_000);

afterAll(() => {
  for (const dir of [anchoredCorpus, bareCorpus]) {
    if (dir.length > 0) rmSync(dir, { recursive: true, force: true });
  }
});

// ─── AC-BFI-4's own assertions ──────────────────────────────────────────────

describe("AC-BFI-4: anchor coverage is enumerable through the existing COUNT_FIELD_ENUMERATORS seam", () => {
  it("HAPPY: --enumerate code_anchor_specs exits EXACTLY 0 and prints as many members as --json counts", () => {
    const jsonCount = statusCodeAnchorSpecs(anchoredCorpus);
    // reason: NON-VACUITY — pinned to the fixture's own anchored population
    // before the comparison, so the equality below can never be `0 === 0`
    // between a truncating enumerator and a broken counter.
    expect(jsonCount).toBe(anchoredSlugs.length);

    const run = runLore(["status", "--enumerate", FIELD], anchoredCorpus);
    expect(run.exitCode).toBe(0);

    // reason: RED (b) — a truncated member list with a correct count field must
    // fail HERE, naming BOTH numbers. `toBe` on a rendered sentence puts the two
    // measurements verbatim in the diff; a bare numeric `toBe` would too, but
    // this also names which surface produced which.
    const members = printedMembers(run.stdout);
    expect(`${FIELD}: --json count=${jsonCount}, --enumerate printed ${members.length} member(s)`).toBe(
      `${FIELD}: --json count=${jsonCount}, --enumerate printed ${jsonCount} member(s)`,
    );
    // The header the CLI prints must agree with the lines it then printed.
    expect(run.stdout).toContain(`${FIELD}: ${jsonCount} member(s)`);
  }, 60_000);

  it("HAPPY: the printed members are EXACTLY the anchor-declaring specs, and no unanchored spec appears", () => {
    const run = runLore(["status", "--enumerate", FIELD], anchoredCorpus);
    expect(run.exitCode).toBe(0);
    expect(printedMembers(run.stdout)).toEqual(anchoredSlugs);
    expect(run.stdout).not.toContain(laterAnchoredSlug);
  }, 60_000);

  it("REGRESSION: --enumerate --json carries the same field/count/members the human render shows", () => {
    const jsonCount = statusCodeAnchorSpecs(anchoredCorpus);
    const run = runLore(["status", "--enumerate", FIELD, "--json"], anchoredCorpus);
    expect(run.exitCode).toBe(0);
    const payload = (JSON.parse(run.stdout) as { data: { field: string; count: number; members: string[] } }).data;
    expect(payload.field).toBe(FIELD);
    expect(payload.members).toEqual(anchoredSlugs);
    expect(`envelope count=${payload.count}, members=${payload.members.length}, status --json=${jsonCount}`).toBe(
      `envelope count=${jsonCount}, members=${jsonCount}, status --json=${jsonCount}`,
    );
  }, 60_000);

  it("STATE: anchoring one more spec moves the count and the member list TOGETHER", () => {
    const before = statusCodeAnchorSpecs(anchoredCorpus);

    const added = runLore(["anchor", "add", laterAnchoredSlug, "src/d.ts#Exported"], anchoredCorpus);
    expect(added.exitCode).toBe(0);

    const after = statusCodeAnchorSpecs(anchoredCorpus);
    expect(after).toBe(before + 1);

    const run = runLore(["status", "--enumerate", FIELD], anchoredCorpus);
    expect(run.exitCode).toBe(0);
    const members = printedMembers(run.stdout);
    expect(members).toContain(laterAnchoredSlug);
    expect(`after anchoring: --json count=${after}, --enumerate printed ${members.length} member(s)`).toBe(
      `after anchoring: --json count=${after}, --enumerate printed ${after} member(s)`,
    );
  }, 90_000);

  it("BOUNDARY: a corpus where no spec declares anchors enumerates ZERO members and still exits EXACTLY 0", () => {
    const jsonCount = statusCodeAnchorSpecs(bareCorpus);
    expect(jsonCount).toBe(0);

    const run = runLore(["status", "--enumerate", FIELD], bareCorpus);
    // An empty member list is a valid answer, never an error: refusing here
    // would make "nothing is anchored" indistinguishable from "unregistered".
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`${FIELD}: 0 member(s)`);
    expect(printedMembers(run.stdout)).toEqual([]);
  }, 60_000);

  it("NEGATIVE: an unregistered field is refused with EXACTLY exit 4, and code_anchor_specs is listed as known", () => {
    const run = runLore(["status", "--enumerate", "code_anchor_spec"], anchoredCorpus);
    expect(run.exitCode).toBe(4);
    const output = `${run.stdout}${run.stderr}`;
    expect(output).toContain("no enumerator registered for count field");
    expect(output).toContain("code_anchor_spec");
    // The refusal enumerates the KNOWN set — this is the assertion that would
    // have caught RED (a): before registration, `code_anchor_specs` itself was
    // the name being refused rather than one of the names offered.
    expect(output).toContain(FIELD);
  }, 30_000);

  it("REGRESSION: the four fields registered before AC-BFI-4 still enumerate, exit EXACTLY 0", () => {
    for (const field of PRE_EXISTING_FIELDS) {
      const run = runLore(["status", "--enumerate", field], bareCorpus);
      expect(`${field} -> exit ${run.exitCode}`).toBe(`${field} -> exit 0`);
      expect(run.stdout).toContain(`${field}: `);
    }
  }, 120_000);
});
