#!/usr/bin/env bun
/**
 * Live-repo mirror integrity — the production half of AC-FR-6 and AC-FR-10 of
 * `spec-falsifiability-reachability-a-feedable-checkpoint-an` (`bun scripts/check-live-mirror-integrity.ts`).
 *
 * PURPOSE: assert, against THIS repository's PRODUCTION corpus and mirror (never a seeded fixture):
 *   AC-FR-6  (a) the test chain (`DEFAULT_STEPS` of scripts/run-chain.ts, followed through package.json `bun run` references) reaches `export-spec-mirror.ts` — WIRED, not
 *                merely present;
 *            (b) the read-only `export-spec-mirror.ts --check` exits a code the script DOCUMENTS
 *                (0 or MIRROR_DRIFT_EXIT_CODE — never a crash) and prints its spec-scoped OK line,
 *                AND an independent re-derivation agrees: on-disk spec mirror count EQUALS the live
 *                corpus spec count with every spec slug present as a file;
 *   AC-FR-10 (a) for every mirrored type, mirror file count EQUALS the live corpus count;
 *            (b) every mirror file's frontmatter `id:` is byte-identical to its filename's leading
 *                identifier, zero-padded to 3 digits;
 *            (c) the migration-coverage eval over `docs/requirements` reports links_broken === 0.
 *
 * These read the repo's live `.lore/` corpus and its `docs/requirements/` tree, so they run here —
 * from a check script — and not from the unit suite (task-skill-test-tg-2). The RED controls
 * (delete a file / un-pad an id / dangle a link must each fail, naming the culprit) and the
 * `--check` drift behaviour (AC-FR-7) run in `scripts/tests/spec-mirror-export.test.ts` against a
 * mkdtemp corpus + mirror, through the SAME functions in `scripts/lib/mirror-integrity.ts`.
 *
 * ⛔ The `--check` exit code is NOT pinned to 0, and that is deliberate: `main`'s code is an AND over
 * all six types and the content probe, so pinning it would assert corpus-wide cleanliness (the job
 * of `bun run check:spec-mirror`, which is in the test chain) rather than AC-FR-6's subject, the
 * SPEC mirror. A crash (MIRROR_HARD_FAILURE_EXIT_CODE) or a killed child still fails here.
 *
 * Usage: `bun scripts/check-live-mirror-integrity.ts [--root <dir>]` — `--root` defaults to this
 * repository; it selects the checkout whose corpus, mirror and package.json are measured (read-only).
 *
 * Exit codes: 0 all conjuncts hold; 1 at least one conjunct failed (each printed); 2 a precondition
 * failed loudly (cannot read package.json, `lore list` did not complete, `--check` was killed).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeMirrorParity,
  countMdFilesFlat,
  loadMirrorMappings,
  MIRROR_DRIFT_EXIT_CODE,
  SPEC_MIRROR_DIR_RELATIVE,
} from "./export-spec-mirror-core.js";
import { chainWiredViolations, measureAllTypesParity, measureLinksBrokenAt, runLoreList } from "./lib/mirror-integrity.js";
import { DEFAULT_STEPS } from "./run-chain.js";

const SCRIPT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `--root <dir>` selects the repository whose corpus and mirror are measured; defaults to this one. */
function parseRoot(argv: readonly string[]): string {
  const i = argv.indexOf("--root");
  if (i === -1) return SCRIPT_REPO_ROOT;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error("--root requires a directory argument");
  return resolve(value);
}

/** The spec-scoped line `--check` prints when every corpus spec has a mirror file. */
const SPEC_OK_LINE = "OK — every corpus spec has a mirror file (count and slug parity; file CONTENT is not compared).";

/** AC-FR-6(a): the test chain (run-chain.ts DEFAULT_STEPS, followed through package.json scripts) reaches the export script. */
function checkChainWired(root: string): string[] {
  const raw = readFileSync(join(root, "package.json"), "utf8");
  const scripts = (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts;
  if (scripts === undefined) throw new Error("package.json has no \"scripts\" section");
  return chainWiredViolations(scripts, DEFAULT_STEPS);
}

/** AC-FR-6(b): one real read-only `--check` pass plus an independent parity re-derivation. */
function checkSpecParity(root: string): string[] {
  const violations: string[] = [];
  const run = spawnSync("bun", ["run", join(root, "scripts", "export-spec-mirror.ts"), "--check"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env },
  });
  if (run.error !== undefined || run.status === null) {
    throw new Error(`export-spec-mirror --check did not run to completion: ${String(run.error?.message ?? run.signal)}`);
  }
  if (run.status !== 0 && run.status !== MIRROR_DRIFT_EXIT_CODE) {
    violations.push(`AC-FR-6(b): --check exited ${run.status}, not a documented code (0 or ${MIRROR_DRIFT_EXIT_CODE}): ${run.stderr.slice(0, 300)}`);
  }
  if (!run.stdout.includes(SPEC_OK_LINE)) violations.push(`AC-FR-6(b): --check did not print the spec-scoped OK line`);

  // Independent re-derivation — never trusts the script's own self-report.
  const specs = runLoreList("spec", root);
  if (specs.length === 0) violations.push("AC-FR-6(b): the live corpus lists zero specs — a vacuous parity pass refused");
  const mappings = loadMirrorMappings(root);
  const parity = computeMirrorParity(
    specs,
    mappings,
    (relPath) => existsSync(join(root, relPath)),
    countMdFilesFlat(join(root, SPEC_MIRROR_DIR_RELATIVE)),
  );
  if (parity.missing.length > 0) {
    violations.push(`AC-FR-6(b): ${parity.missing.length} corpus spec(s) missing a mirror file: ${parity.missing.slice(0, 5).map((m) => `${m.slug} (${m.reason})`).join(", ")}`);
  }
  if (parity.fileCountOnDisk !== parity.corpusSpecCount) {
    violations.push(`AC-FR-6(b): ${parity.fileCountOnDisk} spec mirror file(s) on disk vs ${parity.corpusSpecCount} live corpus spec(s)`);
  }
  return violations;
}

/** AC-FR-10 (a)+(b)+(c) over the real mirror. */
async function checkAllTypes(root: string): Promise<string[]> {
  const violations: string[] = [];
  const parity = measureAllTypesParity(root, root);
  if (parity.totalFilesChecked === 0) violations.push("AC-FR-10: zero mirror files inspected — a vacuous pass refused");
  for (const line of parity.idViolations) violations.push(`AC-FR-10(b): ${line}`);
  for (const line of parity.countMismatches) violations.push(`AC-FR-10(a): ${line}`);
  const links = await measureLinksBrokenAt(root);
  if (links.expected_files === 0) violations.push("AC-FR-10(c): migration-coverage saw zero expected files — a vacuous pass refused");
  if (links.links_broken !== 0) violations.push(`AC-FR-10(c): migration-coverage reports links_broken ${links.links_broken}, not 0`);
  return violations;
}

async function main(argv: readonly string[]): Promise<number> {
  const violations: string[] = [];
  try {
    const root = parseRoot(argv);
    violations.push(...checkChainWired(root));
    violations.push(...checkSpecParity(root));
    violations.push(...(await checkAllTypes(root)));
  } catch (e) {
    console.error(`check-live-mirror-integrity: precondition failed — ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  if (violations.length > 0) {
    for (const v of violations) console.error(`check-live-mirror-integrity: ${v}`);
    return 1;
  }
  console.log(
    "check-live-mirror-integrity: OK — test chain reaches export-spec-mirror.ts, spec mirror count and slugs match the live corpus, every type's mirror count matches, every frontmatter id equals its zero-padded filename id, links_broken is 0",
  );
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
