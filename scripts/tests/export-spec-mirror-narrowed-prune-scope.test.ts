// @spawns packages/lore/src/index.ts
/**
 * AC-MOS-6 — `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by`,
 * `task-a-narrowed-export-must-never-delete-another-type-s-mirror`.
 *
 * The refusal behind the ONE pairing that keeps a `--type`-narrowed WRITE-mode export from
 * deleting five sixths of the mirror.
 *
 * ## The hazard this file refuses
 *
 * `runExport` (`scripts/export-spec-mirror.ts`) ends with:
 *
 * ```ts
 * const pruned = pruneOrphanMirrorFiles(repoRoot, liveMappings, types.map(mirrorDirRelative));
 * ```
 *
 * BOTH arguments are narrowed by the SAME `types` list. `liveMappings` holds only the SCANNED
 * types' live docs, and `pruneOrphanMirrorFiles` deletes every `.md` in every swept directory that
 * the mapping set does not name. Narrow only one side and the other five directories are swept
 * against a doc list that never contained them — every file in each is deleted as an "orphan".
 *
 * ⛔ Measured on this tree (2026-08-25, `bun run scripts/export-spec-mirror.ts --type knowledge`
 * over a six-type throwaway with the third argument mutated to `MIRROR_TYPES.map(mirrorDirRelative)`):
 * five of six mirror directories were emptied, the command exited **0**, and the deletion rendered
 * as `export-spec-mirror: pruned 6 orphaned file(s)` — indistinguishable, in the log, from a
 * deliberate prune. Against this repo's real corpus that is 1800+ files and nothing about the run
 * itself can recover them. Until this file existed, that pairing was held by a CODE COMMENT and
 * NOTHING refused its violation.
 *
 * ## The three conjuncts, and why each is load-bearing
 *
 * All three are measured on ONE narrowed run:
 *
 *   (a) for EVERY OTHER type, its mirror directory is UNCHANGED. ⛔ Asserted PER DIRECTORY, never
 *       as an aggregate total: a total across the six directories stays equal when one loses a
 *       file while another gains one, so a total would be blind to precisely the mis-scoped sweep
 *       this criterion exists to catch. Each directory is compared as a whole snapshot — its
 *       `countMdFilesFlat` count (the SAME helper the production code counts with, never a
 *       reimplementation), its sorted file-name set, and a sha256 per file — so "unchanged" means
 *       byte-unchanged, not merely equinumerous.
 *   (b) every path in the run's `pruned` list lies under `docs/requirements/<X>/`.
 *   (c) POSITIVE CONTROL, SAME run: a genuine orphan seeded INSIDE `docs/requirements/<X>/` IS
 *       pruned and IS named in the log. ⛔ Not optional. Without it, (a) and (b) are both
 *       satisfied perfectly by a prune that deletes nothing at all — the vacuous pass this
 *       criterion would otherwise ship.
 *
 * The smallest mutation that turns this red is the exact asymmetry the code comment names: pass
 * `MIRROR_TYPES.map(mirrorDirRelative)` as the third argument while `liveMappings` stays narrowed.
 * Measured against this file: (a) and (b) go red while (c) STILL PASSES — the seeded orphan is
 * still swept and still named — so the failure is attributable to the mis-scoping rather than to a
 * pruner that stopped working. A control that died alongside the thing it controls would not be a
 * control.
 *
 * ## Isolation — a throwaway corpus, a throwaway repo root, and a redirected HOME
 *
 * ⛔ This is a DESTRUCTIVE path: it drives the WRITING export and it deletes files. Everything it
 * creates or removes lives under a `mkdtempSync(tmpdir(), "lore-mirror-prune-scope-")` directory
 * that serves as BOTH the corpus (`lore init`, ⛔ never this repo's `.lore/`) and the `repoRoot`
 * the mirror is written to; `HOME` is redirected to a subdirectory of it for every spawned process
 * so no user-level lore state is read or written either. `export-spec-mirror.ts` computes its own
 * `REPO_ROOT` from that FILE's location and reaches this fixture ONLY through `main`'s explicit
 * override parameters, so no path this suite touches is nameable by any other process.
 *
 * That is not stylistic. `scripts/tests/spec-mirror-export.test.ts` was rewritten specifically to
 * stop mutating the real tree after one file's mutation of a REAL mirror file reddened
 * `scripts/tests/mirror-status-parity.test.ts` running concurrently in another worker (defect 2 of
 * `task-skill-test-the-mirror-end-to-end-oracles-cost-o-corpus`). Here the stakes are higher still:
 * a mis-scoped run against `docs/requirements/` would delete it, not merely dirty it.
 *
 * The `beforeAll`/`afterAll` porcelain DELTA guard below is the MECHANIZED proof that the isolation
 * held on this run; this paragraph is only the argument. ⛔ It asserts the DELTA, never "porcelain
 * is empty" — this repo is developed by many concurrent sessions and another session may
 * legitimately have the tree dirty while this suite runs.
 *
 * ## Why a driver subprocess rather than importing `main`
 *
 * Same reason as `scripts/tests/export-spec-mirror-type-scope.test.ts` (see its header):
 * `export-spec-mirror.ts` top-level-imports `createApp` -> `bun:sqlite`, unresolvable inside a
 * vitest worker, and a plain `bun scripts/export-spec-mirror.ts` cannot be redirected at a
 * throwaway corpus — only `main(argv, repoRoot, dbPath)` can. The driver forwards its trailing
 * arguments to `argv` UNCHANGED and replicates the script's own `import.meta.main` error mapping,
 * so what is under test is the real argv -> `types` -> `runExport` path, and a `SpecMirrorError`
 * surfaces as the documented hard-failure code rather than as bun's generic 1.
 *
 * The `pruned` list is read back from the command's OWN stdout block, because that block is the
 * only surface a CLI caller has for it — and it is the surface on which the hazard renders as a
 * deliberate prune. {@link parsePrunedPaths} cross-checks the header's declared count against the
 * number of path lines it parsed, so a log-format change fails loud instead of silently yielding
 * an empty list that would make (b) vacuous.
 *
 * Coverage: HAPPY (a narrowed export prunes its own type's orphan and reports it) / NEGATIVE (an
 * orphan in ANOTHER type's directory is NOT pruned by the narrowed run) / BOUNDARY (per-directory
 * byte equality rather than an aggregate count; directories seeded with DIFFERING file counts so a
 * comparison against a constant cannot pass; a non-`.md` stray inside the scanned directory is left
 * alone) / ERROR (every subprocess is asserted to have run to completion — never `status ?? 1` —
 * and the narrowed run's exit code must be EXACTLY 0, so a crash cannot be read as restraint) /
 * STATE (a second identical narrowed run over converged state prunes nothing and changes nothing)
 * / REGRESSION (the UNNARROWED run then deletes the very orphan the narrowed run correctly left,
 * proving the pruner is live across directories — without which "it did not delete Y's orphan" is
 * satisfiable by a pruner that deletes nothing anywhere).
 *
 * Side-effect class: IO — creates throwaway directories under the OS temp dir, spawns `bun`
 * subprocesses, and creates/deletes files inside those directories ONLY. Never touches this repo's
 * `.lore/`, `docs/requirements/`, `dist/`, or the real `HOME`.
 *
 * @spec_ref spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by AC-MOS-6
 */

import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIRROR_TYPES,
  countMdFilesFlat,
  mirrorDirRelative,
  type MirrorDocType,
} from "../export-spec-mirror-core.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
// `.js` specifiers — Bun resolves these to the sibling `.ts` sources (project CLAUDE.md "Import style").
const MIRROR_SCRIPT_JS_SPECIFIER = join(REPO_ROOT, "scripts", "export-spec-mirror.js");
const MIRROR_CORE_JS_SPECIFIER = join(REPO_ROOT, "scripts", "export-spec-mirror-core.js");

/** The type the narrowed export selects — the ONLY directory it is allowed to delete from. */
const SCANNED_TYPE: MirrorDocType = "knowledge";
/** A DIFFERENT mirrored type, used for the cross-directory discrimination case. */
const UNSCANNED_TYPE: MirrorDocType = "adr";
/** The five types a `--type ${SCANNED_TYPE}` run must leave byte-for-byte alone. */
const OTHER_TYPES: readonly MirrorDocType[] = MIRROR_TYPES.filter((t) => t !== SCANNED_TYPE);

const DOCS_REQUIREMENTS_RELATIVE = join("docs", "requirements");
const EXPORT_INDEX_RELATIVE = join(".lore", "export-index.json");

/**
 * 64MiB. The fixture corpus holds a handful of documents, so nothing here comes close — the
 * headroom exists so that a growing report can never be truncated into a SIGTERM that
 * {@link assertSpawnCompleted} would (correctly) refuse to read as an exit code. Same constant and
 * same reasoning as `scripts/tests/spec-mirror-export.test.ts`.
 */
const MAX_SUBPROCESS_BUFFER_BYTES = 64 * 1024 * 1024;

// ─── Loud subprocess accounting (⛔ never `status ?? 1`) ──────────────────────

/**
 * Returns the child's REAL exit code, or throws naming what actually happened.
 *
 * ⛔ `status ?? 1` is this repo's banned pattern here: a `spawnSync` that never completed reports
 * `status: null`, and collapsing that to `1` fabricates an exit code the child never returned —
 * which in THIS suite would let a killed subprocess be read as "the export declined to prune".
 */
function assertSpawnCompleted(label: string, result: ReturnType<typeof spawnSync>): number {
  const spawnError = result.error as NodeJS.ErrnoException | undefined;
  if (spawnError !== undefined || result.status === null) {
    const capturedBytes = (result.stdout ?? "").length + (result.stderr ?? "").length;
    const enobufsDetail =
      spawnError?.code === "ENOBUFS"
        ? ` The child's stdout/stderr reached the maxBuffer of ${MAX_SUBPROCESS_BUFFER_BYTES} bytes, so spawnSync SIGTERM'd it and its output (${capturedBytes} bytes captured) is TRUNCATED, not a result. Raise MAX_SUBPROCESS_BUFFER_BYTES — do not read the truncated output.`
        : "";
    throw new Error(
      `${label}: subprocess did not run to completion — status=${String(result.status)} signal=${String(result.signal)} error.code=${spawnError?.code ?? "none"} error.message=${spawnError?.message ?? "none"}.${enobufsDetail}`,
    );
  }
  return result.status;
}

// ─── The throwaway fixture: corpus + repo root + HOME, all under one mkdtemp ──

interface Fixture {
  /** The `mkdtemp` root — simultaneously the `lore init` corpus root and the mirror's `repoRoot`. */
  readonly root: string;
  /** `<root>/home` — every spawned process's `HOME`, so no user-level lore state is read or written. */
  readonly homeDir: string;
  readonly dbPath: string;
  /** `<root>/mirror-prune-scope-driver.ts` — the `bun run` entry point reaching `main(argv, repoRoot, dbPath)`. */
  readonly driverPath: string;
}

const tmpRoots: string[] = [];

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup — a leftover temp dir must never fail the run
    }
  }
});

/** Environment for every spawned process: redirected `HOME`, and `CLAUDECODE=1` so `lore create` never nests an AI call (SPEC-024's agent surface). */
function fixtureEnv(fixture: Fixture): NodeJS.ProcessEnv {
  return { ...process.env, HOME: fixture.homeDir, CLAUDECODE: "1" };
}

/** Runs the `lore` CLI against the fixture corpus, failing loud on a non-zero exit — a fixture that half-built must never be measured. */
function runLore(fixture: Fixture, args: readonly string[]): string {
  const result = spawnSync("bun", [LORE_ENTRY, ...args], {
    cwd: fixture.root,
    encoding: "utf8",
    maxBuffer: MAX_SUBPROCESS_BUFFER_BYTES,
    env: fixtureEnv(fixture),
  });
  const label = `lore ${args.join(" ")}`;
  const exitCode = assertSpawnCompleted(label, result);
  if (exitCode !== 0) {
    throw new Error(`test setup: ${label} exited ${exitCode}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return result.stdout ?? "";
}

/** Extracts the JSON payload from a `--json` CLI stdout (pretty-printed, so multi-line). */
function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to the slice-based recovery below
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // fall through to the loud failure below
    }
  }
  throw new Error(`No JSON payload found in CLI output:\n${stdout}`);
}

/** Creates one doc and returns its id — fails loud rather than returning a partially known record. */
function createDoc(fixture: Fixture, args: readonly string[]): string {
  const out = runLore(fixture, [...args, "--json"]);
  const created = parseJsonOutput(out) as { ok?: boolean; data?: { id?: string } };
  if (created.ok !== true || created.data?.id === undefined) {
    throw new Error(`test setup: lore ${args.join(" ")} did not return an id: ${out}`);
  }
  return created.data.id;
}

/**
 * `lore create spec` runs behind the `spec-create` gate, which requires these three headings —
 * so the fixture satisfies the gate rather than bypassing it (⛔ `LORE_GATE_BYPASS` is never set
 * here: a fixture built by disabling a gate is a fixture whose shape nobody has verified).
 */
const SPEC_SKELETON = [
  "## Overview",
  "",
  "A spec that exists only so the fixture has a populated `docs/requirements/spec/` directory.",
  "",
  "## Scope",
  "",
  "This throwaway corpus.",
  "",
  "## Acceptance Criteria",
  "",
  "- AC-1: `bun scripts/export-spec-mirror.ts --check` exits 0 against this fixture.",
  "",
].join("\n");

/** Writes the driver: a real `bun run` entry point forwarding its trailing arguments to `main`'s `argv` UNCHANGED. */
function writeDriver(root: string): string {
  const driverPath = join(root, "mirror-prune-scope-driver.ts");
  writeFileSync(
    driverPath,
    `
import { main, SpecMirrorError } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)};
import { MIRROR_HARD_FAILURE_EXIT_CODE } from ${JSON.stringify(MIRROR_CORE_JS_SPECIFIER)};

const [, , dbPath, repoRoot, ...mirrorArgs] = process.argv;
try {
  process.exit(await main(mirrorArgs, repoRoot, dbPath));
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
  return driverPath;
}

/**
 * Builds a throwaway corpus holding at least one doc of EVERY {@link MIRROR_TYPES} type, exports
 * the full mirror, and asserts the baseline export was clean — so any later verdict is
 * attributable to this suite's mutation rather than to a fixture that never converged.
 *
 * ⛔ The per-type doc counts DIFFER on purpose (two `adr`s and two `knowledge`s against one each of
 * the rest): with six identical counts, a broken comparison that measured a constant instead of the
 * per-directory before/after pair would pass, and the whole point of conjunct (a) is that the
 * comparison is genuinely per directory.
 */
function seedSixTypeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "lore-mirror-prune-scope-"));
  tmpRoots.push(root);
  const homeDir = join(root, "home");
  mkdirSync(homeDir, { recursive: true });

  const fixture: Fixture = {
    root,
    homeDir,
    dbPath: join(root, ".lore", "lore.db"),
    driverPath: writeDriver(root),
  };

  runLore(fixture, ["init", "--author", "mirror-prune-scope-test"]);

  const prdId = createDoc(fixture, ["create", "prd", "--title", "Prune Scope Root PRD", "--content", "# Prune Scope Root PRD\n"]);
  createDoc(fixture, ["create", "spec", "--title", "Prune Scope Spec","--kind", "tech", "--content", SPEC_SKELETON]);
  createDoc(fixture, ["create", "adr", "--parent", prdId, "--title", "Prune Scope Decision One", "--decision-status", "accepted", "--content", "# Prune Scope Decision One\n"]);
  createDoc(fixture, ["create", "adr", "--parent", prdId, "--title", "Prune Scope Decision Two", "--decision-status", "accepted", "--content", "# Prune Scope Decision Two\n"]);
  createDoc(fixture, ["create", "knowledge", "--parent", prdId, "--title", "Prune Scope Note One", "--sub-type", "reference", "--content", "# Prune Scope Note One\n"]);
  createDoc(fixture, ["create", "knowledge", "--parent", prdId, "--title", "Prune Scope Note Two", "--sub-type", "reference", "--content", "# Prune Scope Note Two\n"]);
  const planId = createDoc(fixture, ["create", "plan", "--title", "Prune Scope Plan", "--parent", prdId, "--content", "# Prune Scope Plan\n"]);
  createDoc(fixture, ["create", "task", "--title", "Prune Scope Task", "--kind", "code", "--parent", planId, "--plan-id", planId, "--content", "# Prune Scope Task\n"]);

  const baseline = runMirror(fixture);
  if (baseline.exitCode !== 0) {
    throw new Error(`test setup: baseline full export exited ${baseline.exitCode}\n${baseline.stdout}\n${baseline.stderr}`);
  }
  // ⛔ Non-vacuity of the whole fixture: every one of the six directories must actually hold files,
  // or conjunct (a) would be comparing empty directories to empty directories.
  for (const type of MIRROR_TYPES) {
    const count = countMdFilesFlat(join(root, mirrorDirRelative(type)));
    if (count < 1) {
      throw new Error(`test setup: ${mirrorDirRelative(type)} holds ${count} file(s) after the baseline export; expected at least 1`);
    }
  }
  return fixture;
}

// ─── Driving the real command ─────────────────────────────────────────────────

interface MirrorRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs WRITE-mode `export-spec-mirror` (or any argv given) against the fixture, through the real argv parser. */
function runMirror(fixture: Fixture, ...mirrorArgs: readonly string[]): MirrorRun {
  const result = spawnSync("bun", ["run", fixture.driverPath, fixture.dbPath, fixture.root, ...mirrorArgs], {
    encoding: "utf8",
    maxBuffer: MAX_SUBPROCESS_BUFFER_BYTES,
    env: fixtureEnv(fixture),
  });
  const exitCode = assertSpawnCompleted(`export-spec-mirror ${mirrorArgs.join(" ")}`, result);
  return { exitCode, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** `main`'s own prune-block header — the CLI's only surface for the `pruned` list. */
const PRUNE_HEADER_RE = /^export-spec-mirror: pruned (\d+) orphaned file\(s\)/;

/**
 * Reads the run's `pruned` list back out of its stdout block.
 *
 * ⛔ Fails loud on a shape it does not recognise rather than returning `[]`. An empty list would
 * satisfy conjunct (b) vacuously, so a log-format change must redden this file instead of quietly
 * turning (b) into a tautology. Absence of the header is the ONE legitimate empty case (`main`
 * prints the block only when `pruned.length > 0`), and the declared count is cross-checked against
 * the number of path lines actually parsed.
 */
function parsePrunedPaths(stdout: string): readonly string[] {
  const lines = stdout.split("\n");
  const headerIndex = lines.findIndex((line) => PRUNE_HEADER_RE.test(line));
  if (headerIndex === -1) return [];

  const headerLine = lines[headerIndex] ?? "";
  const declared = Number(PRUNE_HEADER_RE.exec(headerLine)?.[1]);
  const paths: string[] = [];
  for (let i = headerIndex + 1; i < headerIndex + 1 + declared; i += 1) {
    const line = lines[i];
    if (line === undefined || !line.startsWith("  ") || line.trim().length === 0) {
      throw new Error(
        `prune block malformed: header declared ${declared} path(s) but line ${i - headerIndex} of the block was ${JSON.stringify(line)}.\nFull stdout:\n${stdout}`,
      );
    }
    paths.push(line.slice(2));
  }
  if (paths.length !== declared) {
    throw new Error(`prune block malformed: header declared ${declared} path(s), parsed ${paths.length}.\nFull stdout:\n${stdout}`);
  }
  return paths;
}

// ─── Per-directory snapshots (⛔ never an aggregate) ──────────────────────────

interface DirSnapshot {
  /** `countMdFilesFlat` — the SAME helper the production parity report counts with, never a reimplementation. */
  readonly count: number;
  /** Sorted `.md` file names. */
  readonly files: readonly string[];
  /** name -> sha256 of the file's raw bytes, so "unchanged" means byte-unchanged and not merely equinumerous. */
  readonly hashes: Readonly<Record<string, string>>;
}

function snapshotMirrorDir(fixture: Fixture, type: MirrorDocType): DirSnapshot {
  const dirAbs = join(fixture.root, mirrorDirRelative(type));
  const files = existsSync(dirAbs)
    ? readdirSync(dirAbs, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name)
        .sort()
    : [];
  const hashes: Record<string, string> = {};
  for (const name of files) {
    hashes[name] = createHash("sha256").update(readFileSync(join(dirAbs, name))).digest("hex");
  }
  return { count: countMdFilesFlat(dirAbs), files, hashes };
}

function snapshotOtherTypes(fixture: Fixture): Record<string, DirSnapshot> {
  const snapshots: Record<string, DirSnapshot> = {};
  for (const type of OTHER_TYPES) snapshots[type] = snapshotMirrorDir(fixture, type);
  return snapshots;
}

/** Repo-relative path of a file inside a type's mirror directory, in the forward-slash form `pruneOrphanMirrorFiles` reports. */
function mirrorRelPath(type: MirrorDocType, fileName: string): string {
  return `${mirrorDirRelative(type)}/${fileName}`;
}

/** Seeds a file that no export-index mapping names — a genuine orphan by construction, since nothing in the corpus ever produced it. */
function seedOrphan(fixture: Fixture, type: MirrorDocType, fileName: string): string {
  const relPath = mirrorRelPath(type, fileName);
  writeFileSync(join(fixture.root, relPath), `# ${fileName}\n\nNo corpus document ever produced this file.\n`, "utf8");
  return relPath;
}

// ─── The working-tree DELTA guard over the REAL repo ─────────────────────────
//
// ⛔ The mechanized proof of this file's "writes only inside its own mkdtemp sandbox" claim, and
// the reason it can be trusted to drive a DESTRUCTIVE command. Asserts the DELTA, never "porcelain
// is empty": another session may legitimately have the tree dirty while this suite runs, so a
// clean-tree assertion would be the exclusivity the North Star forbids AND would fail for reasons
// having nothing to do with this file.

function porcelainForGuardedPaths(): string {
  const result = spawnSync("git", ["status", "--porcelain", DOCS_REQUIREMENTS_RELATIVE, EXPORT_INDEX_RELATIVE], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: MAX_SUBPROCESS_BUFFER_BYTES,
  });
  assertSpawnCompleted("git status --porcelain (working-tree delta guard)", result);
  return result.stdout ?? "";
}

let porcelainAtSuiteStart: string | null = null;

beforeAll(() => {
  porcelainAtSuiteStart = porcelainForGuardedPaths();
});

afterAll(() => {
  expect(porcelainForGuardedPaths()).toBe(porcelainAtSuiteStart);
});

// ─── The criterion ────────────────────────────────────────────────────────────

describe("a narrowed export prunes only the types it read", () => {
  it(
    `AC-MOS-6 (a)+(b)+(c): \`--type ${SCANNED_TYPE}\` leaves every other type's directory byte-identical, prunes only paths under its own, and still prunes a genuine orphan seeded inside it`,
    () => {
      const fixture = seedSixTypeFixture();

      const before = snapshotOtherTypes(fixture);
      const scannedBefore = snapshotMirrorDir(fixture, SCANNED_TYPE);
      const orphanRelPath = seedOrphan(fixture, SCANNED_TYPE, "KN-999-orphan-inside-the-scanned-type.md");

      const run = runMirror(fixture, "--type", SCANNED_TYPE);
      const pruned = parsePrunedPaths(run.stdout);

      // ⛔ `expect.soft` across the three conjuncts, deliberately: the criterion asks for all three
      // IN ONE RUN, and a hard `expect` would abort at the first violated one — making "(a) and (b)
      // failed while (c) held" (the attributable signature of the mis-scoping mutation)
      // indistinguishable in the recorded output from "(c) failed too". Soft assertions report every
      // violated conjunct; the test still fails.

      // The run itself must have been an ordinary successful export. A crash that deleted nothing
      // would otherwise read as restraint.
      expect.soft(run.exitCode).toBe(0);

      // ── (a) PER-DIRECTORY equality for EVERY other type. ⛔ Never an aggregate total: a total
      // stays equal when one directory loses a file while another gains one.
      const after = snapshotOtherTypes(fixture);
      for (const type of OTHER_TYPES) {
        const dirBefore = before[type];
        const dirAfter = after[type];
        // Non-vacuity: an empty directory is trivially unchanged, so each must have held files.
        expect.soft(dirBefore?.count, `${mirrorDirRelative(type)} must be non-empty at baseline`).toBeGreaterThan(0);
        expect.soft(dirAfter?.count, `${mirrorDirRelative(type)} file COUNT changed`).toBe(dirBefore?.count);
        expect.soft(dirAfter, `${mirrorDirRelative(type)} contents changed`).toEqual(dirBefore);
      }

      // ── (b) every pruned path lies under the scanned type's directory.
      const scannedDirPrefix = `${mirrorDirRelative(SCANNED_TYPE)}/`;
      for (const path of pruned) {
        expect.soft(path.startsWith(scannedDirPrefix), `pruned path outside ${scannedDirPrefix}: ${path}`).toBe(true);
      }

      // ── (c) POSITIVE CONTROL, same run: the seeded orphan IS pruned and IS named. Without this,
      // (a) and (b) are both satisfied by a prune that deletes nothing at all.
      expect.soft(pruned, "the seeded orphan must be NAMED in the prune log").toContain(orphanRelPath);
      expect.soft(existsSync(join(fixture.root, orphanRelPath)), "the seeded orphan must be DELETED from disk").toBe(false);

      // ...and the scanned directory is back to exactly its pre-orphan state — the prune removed
      // the orphan and nothing else.
      expect.soft(snapshotMirrorDir(fixture, SCANNED_TYPE)).toEqual(scannedBefore);
    },
    600_000,
  );

  it(
    `NEGATIVE + STATE + REGRESSION: the narrowed run leaves an orphan in \`${UNSCANNED_TYPE}\` and a non-.md stray untouched, repeats without pruning anything, and the UNNARROWED run then deletes that orphan`,
    () => {
      const fixture = seedSixTypeFixture();

      const ownOrphan = seedOrphan(fixture, SCANNED_TYPE, "KN-998-orphan-inside-the-scanned-type.md");
      const foreignOrphan = seedOrphan(fixture, UNSCANNED_TYPE, "ADR-998-orphan-inside-another-type.md");
      // A non-`.md` stray inside the SCANNED directory: pruning is `.md`-only, so a narrowed run
      // must not sweep it either. Over-deletion inside the right directory is still over-deletion.
      const strayRelPath = mirrorRelPath(SCANNED_TYPE, "README.txt");
      writeFileSync(join(fixture.root, strayRelPath), "not a mirror file\n", "utf8");

      // ── NEGATIVE: the narrowed run prunes its OWN orphan and leaves the other type's alone.
      const narrowed = runMirror(fixture, "--type", SCANNED_TYPE);
      const narrowedPruned = parsePrunedPaths(narrowed.stdout);
      expect(narrowed.exitCode).toBe(0);
      expect(narrowedPruned).toContain(ownOrphan);
      expect(narrowedPruned).not.toContain(foreignOrphan);
      expect(existsSync(join(fixture.root, ownOrphan))).toBe(false);
      expect(existsSync(join(fixture.root, foreignOrphan))).toBe(true);
      expect(existsSync(join(fixture.root, strayRelPath))).toBe(true);

      // ── STATE: run the identical command again over the now-converged state. It must prune
      // NOTHING and change nothing — the export is not self-feeding.
      const beforeRepeat = snapshotOtherTypes(fixture);
      const scannedBeforeRepeat = snapshotMirrorDir(fixture, SCANNED_TYPE);
      const repeat = runMirror(fixture, "--type", SCANNED_TYPE);
      expect(repeat.exitCode).toBe(0);
      expect(parsePrunedPaths(repeat.stdout)).toEqual([]);
      expect(snapshotOtherTypes(fixture)).toEqual(beforeRepeat);
      expect(snapshotMirrorDir(fixture, SCANNED_TYPE)).toEqual(scannedBeforeRepeat);

      // ── REGRESSION green control: the UNNARROWED run deletes the very orphan the narrowed run
      // correctly left. ⛔ Without this, "the narrowed run did not delete the foreign orphan" is
      // satisfied just as well by a pruner that deletes nothing anywhere, and the NEGATIVE
      // assertion above would carry no discriminating power at all.
      const full = runMirror(fixture);
      const fullPruned = parsePrunedPaths(full.stdout);
      expect(full.exitCode).toBe(0);
      expect(fullPruned).toContain(foreignOrphan);
      expect(existsSync(join(fixture.root, foreignOrphan))).toBe(false);
      // ...and even the full sweep leaves the non-`.md` stray alone.
      expect(existsSync(join(fixture.root, strayRelPath))).toBe(true);
    },
    600_000,
  );
});
