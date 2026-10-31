// @reads scripts/run-chain.ts -- the wiring case reads the chain steps
// @spawns scripts/check-capture-source-buckets.ts -- every case runs the real scan as a child process over a fixture tree or the real tree
// @reads scripts/check-capture-source-buckets.ts -- the pin test imports scanTree in-process
// @reads packages/** -- the real-tree cases walk every package src directory
// @reads package.json -- the wiring case reads the test chain
// @layer script-unit AC-CT-10 (fixture-tree falsifier suite; the AC's own oracle is the scan itself, `bun scripts/check-capture-source-buckets.ts`)
/**
 * Site-scan suite for `scripts/check-capture-source-buckets.ts` — SPEC-143 AC-CT-10 (R13), task
 * `task-skill-implement-ct-6-ac-ct-10-capture-source-bucket-site`.
 *
 * ## What is pinned
 *
 * The scan refuses a bucketing decision over EITHER axis (`capture_source`, stamp verdict) made
 * outside that axis's classifier file. AC-CT-10's three FALSIFIERS each get a fixture tree, and
 * each is paired with the clean control on the same harness so an exit code cannot be attributed
 * to anything but the fixture:
 *
 *   (a) a raw-field bucketing decision in a non-allowlisted file  -> exit EXACTLY 1, naming it
 *   (b) the tail-guard moved to a new file                        -> exit 0 (exempt BY SHAPE, never by path)
 *   (c) a switch over a classifier return with two accumulators   -> exit 0 (the sanctioned consumer)
 *
 * plus the same decision on the stamp axis (a literal comparison against a `StampVerdict` value),
 * exit EXACTLY 2 for every undecidable scan (empty tree, no classifier, zero sites, empty
 * override env var), the real tree pinned site-by-site ("a test pins today's sites, a scan refuses
 * the next"), and the wiring into `bun run test`.
 *
 * ## Why fixture TREES under `mkdtemp`
 *
 * A genuinely violating file inside the repo would redden the live scan and `bun run test`. So
 * every fixture is a minimal tree (the two classifier files as stubs, since the scan refuses to run
 * without them, plus ONE case file) under the OS temp dir, selected with
 * `LORE_CAPTURE_SOURCE_BUCKETS_REPO_ROOT`. This suite writes nothing inside the repository and
 * never touches the repo's `.lore/`.
 *
 * Six-dimension coverage:
 *   HAPPY:      clean fixture and the real tree exit 0 and report files/sites scanned.
 *   NEGATIVE:   falsifier (a), both axes, exit EXACTLY 1.
 *   BOUNDARY:   one accumulation target is NOT a decision (threshold is two); a raw read passed
 *               straight to the classifier is not one either; (b) and (c).
 *   ERROR:      exit EXACTLY 2 for empty tree / missing classifier / zero sites / empty env var.
 *   STATE:      one tree per case, removed in `afterEach`.
 *   REGRESSION: the real tree's site set is pinned.
 *
 * @spec_ref spec-corpus-truthfulness-a-verdict-must-carry-the-state-it#AC-CT-10
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_STEPS } from "../../../../../scripts/run-chain";

const HERE = dirname(fileURLToPath(import.meta.url));
/** `packages/lore/tests/unit/scripts` -> repo root is five levels up. */
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");
const SCAN_SCRIPT = join(REPO_ROOT, "scripts", "check-capture-source-buckets.ts");
const ROOT_ENV = "LORE_CAPTURE_SOURCE_BUCKETS_REPO_ROOT";
const TIMEOUT_MS = 60_000;

const CAPTURE_CLASSIFIER_FILE = "packages/core/src/task-workflow.ts";
const STAMP_CLASSIFIER_FILE = "packages/core/src/stamp-binding.ts";

/** A minimal classifier file for the capture axis: vocabulary + `classifyCaptureSource` with one site. */
const CAPTURE_CLASSIFIER_STUB = `
export const CAPTURE_SOURCES = ["runner", "self-report", "runner-unattested"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];
export function classifyCaptureSource(captureSource: CaptureSource | undefined): CaptureSource {
  if (captureSource === undefined) return "self-report";
  switch (captureSource) {
    case "runner":
    case "self-report":
    case "runner-unattested":
      return captureSource;
  }
}
`;

/** A minimal classifier file for the stamp axis: the `StampVerdict` union + `readStampVerdict` with one site. */
const STAMP_CLASSIFIER_STUB = `
export type StampVerdict = "bound" | "stale" | "radius_unmeasured" | "unbound" | "legacy_unbound";
export function readStampVerdict(currency: { stamp: string }): StampVerdict {
  return currency.stamp === "unbound" ? "unbound" : "bound";
}
`;

interface ScanRun {
  readonly exitCode: number;
  readonly combined: string;
}

const trees: string[] = [];

afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

/** Writes `files` (repo-relative path -> content) into a fresh tree and returns its root. */
function makeTree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "capture-buckets-"));
  trees.push(root);
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

/** The clean tree both classifier stubs make: every case adds ONE file to it. */
function cleanTree(extra: Readonly<Record<string, string>> = {}): string {
  return makeTree({
    [CAPTURE_CLASSIFIER_FILE]: CAPTURE_CLASSIFIER_STUB,
    [STAMP_CLASSIFIER_FILE]: STAMP_CLASSIFIER_STUB,
    ...extra,
  });
}

/**
 * Runs the scan as a child process. ⛔ Asserts the script EXISTS first: `bun <missing>` exits 1,
 * the exact code falsifier (a) pins as "a violation was found", so a missing scan would otherwise
 * pass every exit-1 case on an empty repository.
 */
function runScan(rootEnv: string | undefined): ScanRun {
  expect(existsSync(SCAN_SCRIPT), `${SCAN_SCRIPT} must exist`).toBe(true);
  const env: Record<string, string | undefined> = { ...process.env };
  delete env[ROOT_ENV];
  if (rootEnv !== undefined) env[ROOT_ENV] = rootEnv;
  const result = spawnSync("bun", [SCAN_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    // explicit maxBuffer per this repo's spawnSync-truncation discipline
    maxBuffer: 20 * 1024 * 1024,
    env: env as NodeJS.ProcessEnv,
  });
  if (result.error !== undefined) throw new Error(`spawn failed: bun ${SCAN_SCRIPT} — ${result.error.message}`);
  return { exitCode: result.status ?? -1, combined: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("AC-CT-10 clean control", () => {
  it("AC-CT-10: a tree holding only the two classifiers exits 0 and says how much it scanned", () => {
    const run = runScan(cleanTree());
    expect(run.exitCode).toBe(0);
    expect(run.combined).toMatch(/scanned 2 file\(s\), 4 site\(s\)/);
  });
});

describe("AC-CT-10 falsifier (a): a raw-field bucketing decision outside the classifier", () => {
  it("AC-CT-10: a capture_source raw read feeding two counters exits EXACTLY 1, naming file, function and axis", () => {
    const run = runScan(
      cleanTree({
        "packages/lore/src/rogue-capture.ts": `
export function tallyCaptures(rows: readonly { capture_source?: string }[]): { runner: number; other: number } {
  let runner = 0;
  let other = 0;
  for (const row of rows) {
    if (row.capture_source === "runner") runner += 1;
    else other += 1;
  }
  return { runner, other };
}
`,
      }),
    );
    expect(run.exitCode).toBe(1);
    expect(run.combined).toContain("packages/lore/src/rogue-capture.ts");
    expect(run.combined).toContain("tallyCaptures");
    expect(run.combined).toContain("[capture_source]");
  });

  it("AC-CT-10: the same decision on the STAMP axis (a literal comparison against a StampVerdict value) exits EXACTLY 1", () => {
    const run = runScan(
      cleanTree({
        "packages/lore/src/rogue-stamp.ts": `
export function tallyStamps(rows: readonly { verdict: string }[]): number[] {
  const counts: number[] = [0, 0];
  const labels: string[] = [];
  for (const row of rows) {
    if (row.verdict === "radius_unmeasured") counts[0] += 1;
    else counts[1] += 1;
    labels.push(row.verdict);
  }
  return counts;
}
`,
      }),
    );
    expect(run.exitCode).toBe(1);
    expect(run.combined).toContain("packages/lore/src/rogue-stamp.ts");
    expect(run.combined).toContain("[stamp_verdict]");
  });

  it("AC-CT-10: a destructured `capture_source` in a two-accumulator function is caught too", () => {
    const run = runScan(
      cleanTree({
        "packages/lore/src/rogue-destructure.ts": `
export function split(rows: readonly { capture_source?: string }[]): string[][] {
  const left: string[] = [];
  const right: string[] = [];
  for (const row of rows) {
    const { capture_source } = row;
    (capture_source === undefined ? left : right).push("x");
    left.push("y");
  }
  return [left, right];
}
`,
      }),
    );
    expect(run.exitCode).toBe(1);
    expect(run.combined).toContain("rogue-destructure.ts");
  });

  it("AC-CT-10: a function writing only ONE accumulation target is below the threshold and exits 0", () => {
    const run = runScan(
      cleanTree({
        "packages/lore/src/one-counter.ts": `
export function countRunner(rows: readonly { capture_source?: string }[]): number {
  let runner = 0;
  for (const row of rows) if (row.capture_source === "runner") runner += 1;
  return runner;
}
`,
      }),
    );
    expect(run.exitCode).toBe(0);
  });
});

describe("AC-CT-10 falsifier (b): the tail-guard is exempt by SHAPE, wherever it lives", () => {
  const TAIL_GUARD = `
export function isRunnerCaptured(entry: { capture_source?: string }): boolean {
  return entry.capture_source === "runner";
}
`;

  it.each([
    ["the file it lives in today", "packages/lore/src/service/task-workflow-service.ts"],
    ["a brand-new file", "packages/lore/src/some/never-seen-before.ts"],
    ["a different package", "packages/other/src/guard.ts"],
  ])("AC-CT-10: the tail-guard in %s exits 0 with no allowlist entry", (_label, file) => {
    const run = runScan(cleanTree({ [file]: TAIL_GUARD }));
    expect(run.exitCode).toBe(0);
    expect(run.combined).toMatch(/exempt-by-shape=1/);
  });

  it("AC-CT-10: control — the SAME read in a function that also writes two accumulators is NOT exempt", () => {
    const run = runScan(
      cleanTree({
        "packages/lore/src/some/never-seen-before.ts": `
export function guardAndCount(entries: readonly { capture_source?: string }[]): number {
  let seen = 0;
  const kept: unknown[] = [];
  for (const entry of entries) {
    seen += 1;
    if (entry.capture_source === "runner") kept.push(entry);
  }
  return seen + kept.length;
}
`,
      }),
    );
    expect(run.exitCode).toBe(1);
  });
});

describe("AC-CT-10 falsifier (c): a switch over a classifier's RETURN value is the sanctioned consumer", () => {
  it("AC-CT-10: a switch over classifyCaptureSource(...) with two accumulators in a new file exits 0", () => {
    const run = runScan(
      cleanTree({
        "packages/lore/src/new-surface.ts": `
import { classifyCaptureSource } from "@lore/core";
export function distribution(rows: readonly { capture_source?: "runner" | "self-report" | "runner-unattested" }[]): number[] {
  let runner = 0;
  let selfReport = 0;
  let unattested = 0;
  for (const row of rows) {
    switch (classifyCaptureSource(row.capture_source)) {
      case "runner":
        runner += 1;
        break;
      case "self-report":
        selfReport += 1;
        break;
      case "runner-unattested":
        unattested += 1;
        break;
    }
  }
  return [runner, selfReport, unattested];
}
`,
      }),
    );
    expect(run.exitCode).toBe(0);
    expect(run.combined).toMatch(/classifier-input=1/);
    expect(run.combined).toMatch(/sanctioned-consumer=3/);
  });

  it("AC-CT-10: a switch over a local `const bucket = readStampVerdict(...)` with two accumulators exits 0", () => {
    const run = runScan(
      cleanTree({
        "packages/lore/src/new-stamp-surface.ts": `
import { readStampVerdict } from "./service/gate-predicates.js";
export function stampDistribution(rows: readonly { stamp: string }[]): number[] {
  let bound = 0;
  let unbound = 0;
  for (const row of rows) {
    const verdict = readStampVerdict(row);
    switch (verdict) {
      case "bound":
        bound += 1;
        break;
      case "unbound":
        unbound += 1;
        break;
      default:
        break;
    }
  }
  return [bound, unbound];
}
`,
      }),
    );
    expect(run.exitCode).toBe(0);
    expect(run.combined).toMatch(/sanctioned-consumer=2/);
  });

  it("AC-CT-10: control — the same loop switching on the RAW field instead exits 1", () => {
    const run = runScan(
      cleanTree({
        "packages/lore/src/new-surface.ts": `
export function distribution(rows: readonly { capture_source?: "runner" | "self-report" }[]): number[] {
  let runner = 0;
  let selfReport = 0;
  for (const row of rows) {
    switch (row.capture_source) {
      case "runner":
        runner += 1;
        break;
      default:
        selfReport += 1;
    }
  }
  return [runner, selfReport];
}
`,
      }),
    );
    expect(run.exitCode).toBe(1);
  });
});

describe("AC-CT-10 the scan breaks loudly (exit EXACTLY 2), never silently clean", () => {
  it("AC-CT-10: a tree with no packages exits 2, paired with the clean control exiting 0", () => {
    expect(runScan(cleanTree()).exitCode).toBe(0);
    const empty = makeTree({ "README.md": "nothing to scan\n" });
    const run = runScan(empty);
    expect(run.exitCode).toBe(2);
    expect(run.combined).toContain("check-capture-source-buckets");
  });

  it("AC-CT-10: a missing capture classifier file exits 2 naming it", () => {
    const run = runScan(makeTree({ [STAMP_CLASSIFIER_FILE]: STAMP_CLASSIFIER_STUB }));
    expect(run.exitCode).toBe(2);
    expect(run.combined).toContain(CAPTURE_CLASSIFIER_FILE);
  });

  it("AC-CT-10: a classifier file that no longer declares its classifier exits 2", () => {
    const run = runScan(
      makeTree({
        [CAPTURE_CLASSIFIER_FILE]: CAPTURE_CLASSIFIER_STUB.replace("classifyCaptureSource", "renamedAway"),
        [STAMP_CLASSIFIER_FILE]: STAMP_CLASSIFIER_STUB,
      }),
    );
    expect(run.exitCode).toBe(2);
    expect(run.combined).toContain("classifyCaptureSource");
  });

  it("AC-CT-10: zero scanned SITES exits 2 even though files were walked (AS-17)", () => {
    const run = runScan(
      makeTree({
        [CAPTURE_CLASSIFIER_FILE]: `
export const CAPTURE_SOURCES = ["runner", "self-report", "runner-unattested"] as const;
export function classifyCaptureSource(value: string | undefined): string { return value ?? "self-report"; }
`,
        [STAMP_CLASSIFIER_FILE]: `
export type StampVerdict = "bound" | "stale" | "radius_unmeasured" | "unbound" | "legacy_unbound";
export function readStampVerdict(value: string): StampVerdict { return value === "x" ? "bound" : "unbound"; }
`,
      }),
    );
    expect(run.exitCode).toBe(2);
    expect(run.combined).toMatch(/zero bucketing sites/);
  });

  it("AC-CT-10: a set-but-empty override env var exits 2 rather than scanning the cwd or the real repo", () => {
    const run = runScan("");
    expect(run.exitCode).toBe(2);
    expect(run.combined).toContain(ROOT_ENV);
  });
});

/** The real tree's sites, pinned WITHOUT line numbers so an unrelated edit above a site does not redden this. */
const PINNED_REAL_SITES: readonly string[] = [
  "allowlisted|stamp_verdict|raw-field-read|packages/lore/src/service/state-binding-service.ts|reportImpact>(anonymous)",
  "classifier-file|capture_source|case-literal|packages/core/src/task-workflow.ts|classifyCaptureSource",
  "classifier-file|capture_source|literal-comparison|packages/core/src/task-workflow.ts|rejectSelfLabelledRunnerUnattested",
  "classifier-file|capture_source|raw-field-read|packages/core/src/task-workflow.ts|resolveWrittenCaptureSource",
  "classifier-file|stamp_verdict|raw-field-read|packages/core/src/stamp-binding.ts|readStampVerdict",
  "classifier-file|stamp_verdict|raw-field-read|packages/core/src/stamp-binding.ts|stampCurrencyOf",
  "classifier-input|capture_source|raw-field-read|packages/lore/src/adapters/cli/commands/status.ts|collectCaptureSourceMembers>(anonymous)",
  "exempt-by-shape|capture_source|literal-comparison|packages/lore/src/service/task-workflow-service.ts|rejectMissingPassOutputTail",
  "exempt-by-shape|capture_source|raw-field-read|packages/lore/src/service/phase-workflow-service.ts|_addEvidenceImpl",
  "exempt-by-shape|capture_source|raw-field-read|packages/lore/src/service/task-finish-service.ts|hasRedRow>(anonymous)",
  "exempt-by-shape|capture_source|raw-field-read|packages/lore/src/service/task-workflow-service.ts|_addEvidenceImpl",
  "exempt-by-shape|capture_source|raw-field-read|packages/lore/src/service/task-workflow-service.ts|isRunnerCaptured",
  "exempt-by-shape|capture_source|raw-field-read|packages/lore/src/service/task-workflow-service.ts|isRunnerProducedRow",
  "exempt-by-shape|stamp_verdict|raw-field-read|packages/core/src/stamp-binding.ts|classifyEvidenceStamps>(anonymous)",
  "exempt-by-shape|stamp_verdict|raw-field-read|packages/lore/src/adapters/http/index.ts|resolveDashboardHealthStamp",
  "exempt-by-shape|stamp_verdict|raw-field-read|packages/lore/src/service/integrate-oracle-service.ts|floorCoveredOutcome",
  "exempt-by-shape|stamp_verdict|raw-field-read|packages/lore/src/service/milestone-attestation-facts.ts|attestationRowsOf",
  "exempt-by-shape|stamp_verdict|raw-field-read|packages/lore/src/service/stamp-binding-reader.ts|measureRadiusByDoc>(anonymous)",
  "exempt-by-shape|stamp_verdict|raw-field-read|packages/lore/src/service/state-binding-skip.ts|findUnresolvedStateBindingSkips>(anonymous)>(anonymous)",
  "sanctioned-consumer|capture_source|case-literal|packages/lore/src/adapters/cli/commands/status.ts|collectCaptureSourceMembers>(anonymous)",
  "sanctioned-consumer|stamp_verdict|case-literal|packages/core/src/stamp-binding.ts|tallyStampReadings",
  "sanctioned-consumer|stamp_verdict|literal-comparison|packages/lore/src/service/gate-predicates.ts|stampVerdictDistribution",
  "sanctioned-consumer|stamp_verdict|literal-comparison|packages/lore/src/service/task-workflow-service.ts|unboundReasonOf",
];

describe("AC-CT-10 the real tree", () => {
  it("AC-CT-10: exits 0 and reports a non-zero count of files and sites scanned", () => {
    const run = runScan(undefined);
    expect(run.exitCode).toBe(0);
    const summary = /scanned (\d+) file\(s\), (\d+) site\(s\)/.exec(run.combined);
    expect(summary).not.toBeNull();
    expect(Number(summary?.[1])).toBeGreaterThan(100);
    expect(Number(summary?.[2])).toBeGreaterThan(10);
    expect(run.combined).toMatch(/violation=0/);
  }, TIMEOUT_MS);

  it("AC-CT-10: pins today's sites — a NEW site (or a moved one) changes this set and fails here", async () => {
    expect(existsSync(SCAN_SCRIPT)).toBe(true);
    const { scanTree } = (await import(SCAN_SCRIPT)) as typeof import("../../../../../scripts/check-capture-source-buckets.js");
    const report = scanTree(REPO_ROOT);
    const observed = [
      ...new Set(report.sites.map((s) => `${s.disposition}|${s.axis}|${s.kind}|${s.file}|${s.fn}`)),
    ].sort();
    expect(observed).toEqual([...PINNED_REAL_SITES].sort());
    expect(report.violations).toEqual([]);
  }, TIMEOUT_MS);

  it("AC-CT-10: the capture_source tail-guard `isRunnerCaptured` is the only raw read left outside the classifier that decides nothing", async () => {
    const { scanTree } = (await import(SCAN_SCRIPT)) as typeof import("../../../../../scripts/check-capture-source-buckets.js");
    const report = scanTree(REPO_ROOT);
    const guard = report.sites.filter((s) => s.fn === "isRunnerCaptured");
    expect(guard).toHaveLength(1);
    expect(guard[0]?.disposition).toBe("exempt-by-shape");
    expect(guard[0]?.accumulationTargets).toBe(0);
    // the capture_source axis needs NO allowlist entry: only the stamp axis has two
    const { ALLOWLIST } = (await import(SCAN_SCRIPT)) as typeof import("../../../../../scripts/check-capture-source-buckets.js");
    expect(ALLOWLIST.filter((entry) => entry.axis === "capture_source")).toEqual([]);
    // CT-6b: the allowlist has exactly ONE row — `reportImpact`'s what-if count. The tally lives beside
    // `readStampVerdict` in @lore/core now and is enforced by the scan, not waived.
    expect(ALLOWLIST.map((entry) => `${entry.axis}|${entry.file}`)).toEqual([
      "stamp_verdict|packages/lore/src/service/state-binding-service.ts",
    ]);
    expect(ALLOWLIST[0]?.reason).toContain("reportImpact");
    for (const entry of ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(report.sites.some((s) => s.disposition === "allowlisted" && s.file === entry.file)).toBe(true);
    }
  }, TIMEOUT_MS);
});

describe("AC-CT-10 / CT-6b: a consumer living in the classifier FILE is still enforced", () => {
  it("AC-CT-10: a raw `switch (reading.stamp)` tally beside readStampVerdict in the stamp classifier file exits EXACTLY 1, naming the function", () => {
    const run = runScan(
      cleanTree({
        [STAMP_CLASSIFIER_FILE]: `${STAMP_CLASSIFIER_STUB}
export function tallyByStamp(readings: readonly { stamp: string }[]): number {
  let stamped = 0;
  let unbound = 0;
  for (const reading of readings) {
    switch (reading.stamp) {
      case "stamped":
        stamped += 1;
        break;
      case "unbound":
        unbound += 1;
        break;
    }
  }
  return stamped + unbound;
}
`,
      }),
    );
    expect(run.exitCode).toBe(1);
    expect(run.combined).toContain("tallyByStamp");
  });

  it("AC-CT-10: a tally beside readStampVerdict that switches over readStampVerdict's RETURN exits 0", () => {
    const run = runScan(
      cleanTree({
        [STAMP_CLASSIFIER_FILE]: `${STAMP_CLASSIFIER_STUB}
export function tallyByVerdict(readings: readonly { stamp: string }[]): number {
  let bound = 0;
  let other = 0;
  for (const reading of readings) {
    const verdict = readStampVerdict(reading);
    switch (verdict) {
      case "bound":
        bound += 1;
        break;
      default:
        other += 1;
    }
  }
  return bound + other;
}
`,
      }),
    );
    expect(run.exitCode).toBe(0);
  });
});

describe("AC-CT-10 wiring", () => {
  it("AC-CT-10: `bun run test` runs the scan, through a named check script that runs the AC command", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:capture-source-buckets"]).toBe("bun scripts/check-capture-source-buckets.ts");
    expect(pkg.scripts["test"]).toContain("scripts/run-chain.ts");
    expect(DEFAULT_STEPS).toContain("bun run check:capture-source-buckets");
  });
});
