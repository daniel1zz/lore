/**
 * `lore setup --check` — read-only asset-freshness projection (SPEC-076 §C3,
 * Downstream Handoff; task task-skill-implement-t4-lore-setup-check-read-only-projection,
 * AC-076-2). Thin CLI-adapter module: reads the target's installed setup
 * manifest + the compiled binary's embedded asset manifest, classifies every
 * managed entry via `@lore/core`'s pure `planUpdate` five-state classifier,
 * prints a report, and writes ONLY the check cache file
 * (`<claude-dir>/.lore-setup-check.json`, SPEC-076 §C6's `SetupCheckCache`
 * shape) — never a target asset file, never the setup manifest itself.
 *
 * Public surface:
 *   - computeSetupCheckReport(opts) — the PURE "do the check" half: reads
 *     the manifest, classifies every managed entry, writes the check cache
 *     (module doc's one write exception), and returns
 *     `Result<SetupCheckReport, LoreError>` — never prints anything, never
 *     touches `process.exitCode`. Extracted (2026-08-24, the `--check
 *     --json` double-document fix — `commands/setup.ts`'s `--check`
 *     dispatch previously `console.log`'d this module's own report AND the
 *     GitHub-channel health probe's report as two SEPARATE top-level JSON
 *     values, which is not valid JSON to any `JSON.parse(stdout)` consumer)
 *     so that dispatch can compose ONE document (`data.github_channel`
 *     alongside this report's own fields) instead of two. `runSetupCheck`
 *     below is a thin wrapper over this function and keeps its own
 *     standalone behavior byte-identical.
 *   - runSetupCheck(opts) — orchestrates the whole `--check` run, sets
 *     `process.exitCode` (0 sync / 3 stale / mapped `LoreError` code on a
 *     read/parse failure), prints text or `--json` output.
 *   - SetupCheckReport / SetupCheckFiles — the `--json` payload shape
 *     (`{summary, binary_version, installed_binary_version?, installed_at?,
 *     files: {outdated[], diverged[], missing[], orphaned[]}}`, exactly
 *     SPEC-076 §C3's documented `--json` contract).
 *   - SetupCheckCache — the persisted cache file shape (SPEC-076 §C6
 *     Downstream Handoff, verbatim: `{checked_at, binary_version, status,
 *     stale_counts?}`), additively extended by task task-skill-implement-t8b
 *     with an OPTIONAL `reminder_enabled: false` (present ONLY when the
 *     resolved `setup.check_reminder` config is `false` — see
 *     `resolveCheckReminderEnabled` below).
 *
 * Invariants:
 *   - ZERO MUTATION beyond the check cache file (SPEC-076 Invariant I4 /
 *     D-PLAN-4, "`--check` is the ONLY mode allowed to write ANYTHING, and
 *     that anything is the cache file alone"). Every other read in this
 *     module (installed manifest, on-disk file bytes for hashing, the
 *     managed-directory walk for orphan discovery) is a plain synchronous
 *     `node:fs` READ. The one write goes through `RealSetupFsWriter.write`
 *     (`../real-setup-fs.js`) — the SAME atomic temp+rename implementation
 *     `SetupService` itself uses for every real asset write, reused here
 *     rather than hand-rolling a second atomic-write path.
 *   - `MANIFEST_FILENAME` is imported from `../../service/setup-service.ts`
 *     (SPEC-076 T5) — that module exported its own constant of the same name
 *     once T5 landed, replacing what was previously a DELIBERATE literal
 *     duplicate here (T4 predates T5; at the time this module was written,
 *     `setup-service.ts` was a concurrently-claimed sibling task's exclusive
 *     anchor, so this module carried its own copy of SPEC-046's stable
 *     on-disk manifest-filename contract rather than importing it). A
 *     regression test in the paired integration suite reads a REAL manifest
 *     `SetupService.install()` wrote, which would fail loud (manifest not
 *     found → treated as "fresh target") if the single SSOT literal were
 *     ever wrong.
 *   - The embedded manifest handed to `planUpdate` is FILTERED to exclude
 *     `kind: "project"` entries — `assets/project/` is the PER-REPO project
 *     scaffold's own asset set (`lore setup --project`'s separate
 *     `ProjectSetupService`/`ProjectFsPort` path), never written by the
 *     global machine installer this check targets (mirrors
 *     `real-asset-source.ts`'s own "assets/project/ is DELIBERATELY
 *     excluded" invariant — `RealAssetSource` is this check's install-time
 *     counterpart, and the two must agree on scope or a fresh converged
 *     install would spuriously report every project-kind entry `missing`).
 *     **SPEC-083 D3**: the SAME filter ALSO drops every path
 *     `real-asset-source.ts`'s exported `isRetiredFromInstall` names (the
 *     `RETIRED_FROM_INSTALL_PATHS` set and the binary-read `context/` top dir) — that predicate is `RealAssetSource`'s
 *     OWN install-time exclusion, imported here rather than re-declared, so
 *     the two enumerations structurally cannot drift apart again (they did
 *     once: `isRetiredFromInstall` originally existed only inside
 *     `RealAssetSource.load()`'s walk, so this check classified the excluded
 *     file `missing` on every freshly converged target). `tree_digest` is
 *     carried through UNCHANGED (still the WHOLE-tree digest, project AND
 *     retired entries included) — it is compared only for EQUALITY against
 *     `installed.assets_digest` (itself the whole-tree digest stamped at the
 *     last successful install/converge, per `setup-manifest.ts`'s own module
 *     doc), never re-derived from this filtered subset.
 *   - `RealSetupCheckProbe.listManagedPaths()` walks the SAME four top-level
 *     directories `RealAssetSource` walks (`skills`/`agents`/`hooks`/
 *     `governance`) — this is the orphan-discovery surface; a nonexistent
 *     top-level dir (never-installed target) is silently skipped, not an
 *     error (an empty/fresh target legitimately has none of these yet).
 *   - A malformed installed manifest (unparsable JSON, or valid JSON failing
 *     `setupManifestSchema`) is a LOUD `VALIDATION_ERROR` (exit 4 via the
 *     shared `exitCode()`/`formatError()` pipeline), never silently treated
 *     as "no prior install" — collapsing corruption into "fresh" would mask
 *     a real on-disk problem and misreport every managed entry as merely
 *     `missing` instead of surfacing the actual manifest damage. A GENUINELY
 *     absent manifest file (ENOENT) IS the legitimate "fresh target" signal
 *     (`installed: null`) — `planUpdate` itself already documents that this
 *     classifies every embedded entry as `missing` (install-equivalent).
 *   - `resolveCheckReminderEnabled` (task task-skill-implement-t8b, SPEC-076
 *     §C6 D5) reads `setup.check_reminder` from the TEAM `.lore/config.yaml`
 *     — walked up from `opts.cwd` (default `process.cwd()`), the same
 *     "nearest ancestor `.lore/`" convention `loader.ts::findLoreDbPath`
 *     uses, but WITHOUT that helper's `process.exit(1)` on a miss: `--check`
 *     must keep working (default enabled) outside any project, and this
 *     module already forgoes `loadLoreApp()` entirely (see the "bootstrap-
 *     stage" invariant above). No `.lore/config.yaml` found, or found but
 *     unparsable/invalid → fail-open (`resolveSetupCheckReminderEnabled(undefined)
 *     === true`), never a hard failure of the `--check` run itself. Reuses
 *     `@lore/core/node`'s `loadConfig` (the SAME parse `loader.ts` builds on)
 *     rather than hand-rolling a second YAML reader.
 *
 * Side-effect class: IO (synchronous `node:fs` reads; one atomic write — the
 *   check cache file only).
 * Source: SPEC-076 §C3 (five-state table, `--check` CLI contract), §C6
 *   (`SetupCheckCache` shape), Downstream Handoff; task
 *   task-skill-implement-t4-lore-setup-check-read-only-projection, AC-076-2.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { err, ok, planUpdate, resolveSetupCheckReminderEnabled, setupManifestSchema } from "@lore/core";
import type { LoreError, Result, SetupManifest, UpdateProbe } from "@lore/core";
// reason: loadConfig reads `<dir>/.lore/config.yaml` via Node fs — only
// reachable via the `@lore/core/node` subpath (browser-safety split,
// packages/core/src/CLAUDE.md). This is a plain fs+yaml read, NOT a
// bun:sqlite dependency — safe to import from this bootstrap-stage module
// (which, per the module doc above, deliberately never calls `loadLoreApp()`).
import { loadConfig } from "@lore/core/node";

import { EMBEDDED_ASSETS_MANIFEST, LORE_BINARY_VERSION } from "../../generated/assets-manifest.js";
import type { EmbeddedAssetEntry } from "../../generated/assets-manifest.js";
import { RealSetupFsWriter } from "../real-setup-fs.js";
import { isRetiredFromInstall } from "../real-asset-source.js";
import { MANIFEST_FILENAME } from "../../service/setup-service.js";
import { exitCode, formatError } from "./utils.js";

// ─── On-disk artifact filenames ─────────────────────────────────────────────

/** `<claude-dir>/.lore-setup-check.json` — SPEC-076 §C6's check cache path. */
const CHECK_CACHE_FILENAME = ".lore-setup-check.json";

/** Top-level `assets/` (== install-target) directories a managed-ownership entry can live under. */
const MANAGED_TOP_LEVEL_DIRS = ["skills", "agents", "hooks", "governance"] as const;

// ─── SetupCheckCache (SPEC-076 §C6 Downstream Handoff) ─────────────────────

/** Zod schema for the persisted check-cache file — see module doc. */
const setupCheckCacheSchema = z.object({
  /** ISO-8601 timestamp of this check run. */
  checked_at: z.string().min(1),
  /** The CURRENTLY-RUNNING binary's embedded `LORE_BINARY_VERSION` at check time. */
  binary_version: z.string().min(1),
  status: z.enum(["sync", "stale"]),
  /** Present iff `status === "stale"` — per-state counts for the session-start advisory (Phase F, a later task). */
  stale_counts: z
    .object({
      outdated: z.number().int().nonnegative(),
      diverged: z.number().int().nonnegative(),
      missing: z.number().int().nonnegative(),
    })
    .optional(),
  /**
   * Present ONLY as `false`, and ONLY when the resolved `setup.check_reminder`
   * config is `false` (SPEC-076 §C6 D5, task task-skill-implement-t8b) — mirrors
   * the `attestation.first_seen?: boolean` "present iff true" precedent
   * (SPEC-039 §M2), just inverted to "present iff false". Absence (legacy cache,
   * or a run where the reminder is enabled) is read by the hook as enabled —
   * fail-open, byte-identical to pre-T8b cache shape.
   */
  reminder_enabled: z.literal(false).optional(),
});

/** Derived TypeScript type for the check-cache file (SPEC-076 §C6 Downstream Handoff). */
export type SetupCheckCache = z.infer<typeof setupCheckCacheSchema>;

// ─── --json / report shape (SPEC-076 §C3's documented `--json` contract) ──

/** The four non-`sync` freshness buckets `--check`'s report/`--json` surfaces (SPEC-076 §C3). */
export interface SetupCheckFiles {
  outdated: string[];
  diverged: string[];
  missing: string[];
  orphaned: string[];
}

/** The full `--check` report — also the `--json` flag's `data` payload, verbatim. */
export interface SetupCheckReport {
  summary: "sync" | "stale";
  /** The CURRENTLY-RUNNING binary's embedded version (always present). */
  binary_version: string;
  /** The installed manifest's recorded `binary_version`, when present (absent on a pre-SPEC-076 or fresh manifest). */
  installed_binary_version?: string;
  /** The installed manifest's recorded `installed_at`, when present. */
  installed_at?: string;
  files: SetupCheckFiles;
}

// ─── Embedded manifest scoping (see module doc) ────────────────────────────

/**
 * The machine-installer-relevant view of the embedded asset manifest —
 * `kind: "project"` entries excluded (see module doc), PLUS every path
 * `isRetiredFromInstall` names (SPEC-083 D3, `../real-asset-source.js` —
 * the SAME predicate `RealAssetSource.load()` uses to exclude those paths
 * from what it actually installs). Both filters must agree: the embedded
 * manifest still fingerprints every real file under `assets/` (it ships with
 * the package regardless of install scope), so a path this check's
 * classifier doesn't ALSO know to skip would report `missing` on every
 * freshly converged target forever (the 2026-07-26 regression this shared
 * import fixes — see `isRetiredFromInstall`'s own doc for why a
 * hand-duplicated literal path here was rejected instead).
 */
export function buildCheckEmbeddedManifest(): {
  binary_version: string;
  tree_digest: string;
  entries: readonly EmbeddedAssetEntry[];
} {
  return {
    binary_version: LORE_BINARY_VERSION,
    tree_digest: EMBEDDED_ASSETS_MANIFEST.tree_digest,
    entries: EMBEDDED_ASSETS_MANIFEST.entries.filter(
      (entry) => entry.kind !== "project" && !isRetiredFromInstall(entry.path),
    ),
  };
}

// ─── Installed manifest read (see module doc's fail-loud-on-corruption invariant) ──

/**
 * Reads and validates the target's installed setup manifest. A genuinely
 * ABSENT file is the legitimate "fresh target" signal (`ok(null)`); a
 * PRESENT-but-corrupted file is a loud `VALIDATION_ERROR` — see module doc.
 */
function readInstalledManifest(targetDir: string): Result<SetupManifest | null, LoreError> {
  const manifestPath = join(targetDir, MANIFEST_FILENAME);

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return ok(null);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (cause) {
    return err({
      code: "VALIDATION_ERROR",
      field: "manifest",
      message: `lore setup --check: malformed JSON at "${manifestPath}": ${describeCaught(cause)}`,
      value: manifestPath,
    });
  }

  const parsed = setupManifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "manifest",
      message: `lore setup --check: manifest at "${manifestPath}" failed schema validation: ${parsed.error.message}`,
      value: manifestPath,
    });
  }
  return ok(parsed.data);
}

function describeCaught(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

// ─── Real, read-only UpdateProbe ────────────────────────────────────────────

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Recursively collects every regular file under `dir`, as POSIX paths relative to `dir`. Mirrors `real-asset-source.ts`'s own private helper of the same shape. */
function walkFilesRelative(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(current, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(dir, "");
  return out;
}

/**
 * Real, read-only `UpdateProbe` (`@lore/core`'s `plan-update.ts` port) for
 * `lore setup --check`. Mirrors `real-fs-probe.ts`'s "one real implementation
 * behind an injected port" shape (SPEC-045 §Design Decisions D4 precedent).
 * NEVER writes — both members are synchronous `node:fs` reads only.
 */
class RealSetupCheckProbe implements UpdateProbe {
  constructor(private readonly targetDir: string) {}

  resolve(relPath: string): { sha256: string } | "missing" {
    try {
      return { sha256: sha256OfFile(join(this.targetDir, relPath)) };
    } catch {
      return "missing";
    }
  }

  listManagedPaths(): string[] {
    const out: string[] = [];
    for (const topDir of MANAGED_TOP_LEVEL_DIRS) {
      const dirPath = join(this.targetDir, topDir);
      if (!existsSync(dirPath)) continue;
      for (const rel of walkFilesRelative(dirPath)) {
        out.push(`${topDir}/${rel}`);
      }
    }
    return out;
  }
}

// ─── setup.check_reminder config resolution (SPEC-076 §C6 D5, T8b) ─────────

/**
 * Walks from `startDir` up to filesystem root looking for the nearest
 * ancestor directory containing `.lore/config.yaml` — the TEAM config file
 * `setup.check_reminder` (SPEC-076 §C6) lives in. Mirrors
 * `loader.ts::findLoreDbPath`'s upward-walk shape, but NEVER exits the
 * process on a miss (returns `undefined` instead) — this module's `--check`
 * run must keep working (default enabled) outside any project.
 */
function findProjectConfigDir(startDir: string): string | undefined {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, ".lore", "config.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Resolves the effective `setup.check_reminder` value (SPEC-076 §C6 D5) by
 * locating and parsing the nearest ancestor `.lore/config.yaml` from `cwd`.
 * Fail-open at every step (no project config found, or found but unparsable/
 * schema-invalid) — `resolveSetupCheckReminderEnabled(undefined)` already
 * defaults to `true`, so this function never blocks or fails the `--check`
 * run itself over a config-read problem.
 */
function resolveCheckReminderEnabled(cwd: string): boolean {
  const projectDir = findProjectConfigDir(cwd);
  if (projectDir === undefined) return resolveSetupCheckReminderEnabled(undefined);

  const configResult = loadConfig(projectDir);
  if (!configResult.ok) return resolveSetupCheckReminderEnabled(undefined);

  return resolveSetupCheckReminderEnabled(configResult.value);
}

// ─── Check-cache write (the SOLE write this command performs) ─────────────

function buildCache(report: SetupCheckReport, checkedAt: string, reminderEnabled: boolean): SetupCheckCache {
  const base = {
    checked_at: checkedAt,
    binary_version: report.binary_version,
    status: report.summary,
    ...(reminderEnabled ? {} : { reminder_enabled: false as const }),
  };
  if (report.summary !== "stale") return base;
  return {
    ...base,
    stale_counts: {
      outdated: report.files.outdated.length,
      diverged: report.files.diverged.length,
      missing: report.files.missing.length,
    },
  };
}

async function writeCheckCache(
  targetDir: string,
  report: SetupCheckReport,
  nowIso: string,
  reminderEnabled: boolean,
): Promise<void> {
  const cache = setupCheckCacheSchema.parse(buildCache(report, nowIso, reminderEnabled));
  const writer = new RealSetupFsWriter();
  await writer.write(join(targetDir, CHECK_CACHE_FILENAME), `${JSON.stringify(cache, null, 2)}\n`);
}

// ─── Text rendering ─────────────────────────────────────────────────────────

function renderSetupCheckReport(report: SetupCheckReport, targetDir: string): string {
  const lines: string[] = [
    report.summary === "sync" ? `✓ lore assets in sync → ${targetDir}` : `✗ lore assets stale → ${targetDir}`,
    `  binary_version: ${report.binary_version}`,
  ];
  if (report.installed_binary_version !== undefined) {
    lines.push(`  installed_binary_version: ${report.installed_binary_version}`);
  }
  if (report.installed_at !== undefined) {
    lines.push(`  installed_at: ${report.installed_at}`);
  }

  const sections: Array<[label: string, paths: string[]]> = [
    ["outdated", report.files.outdated],
    ["diverged", report.files.diverged],
    ["missing", report.files.missing],
    ["orphaned", report.files.orphaned],
  ];
  for (const [label, paths] of sections) {
    if (paths.length === 0) continue;
    lines.push("", `${label} (${paths.length}):`);
    for (const path of paths) {
      lines.push(`  ${path}`);
      if (label === "diverged") {
        lines.push("    repair: lore setup --yes --force-diverged");
      }
    }
  }
  return lines.join("\n");
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/**
 * The pure "do the check" half of `runSetupCheck` — see this module's
 * "Public surface" doc above. Reads the installed manifest, classifies
 * every managed entry via `planUpdate`, resolves the team's
 * `setup.check_reminder` config (`resolveCheckReminderEnabled`), and writes
 * the check cache (the run's ONLY write — see module doc). Never prints
 * anything, never touches `process.exitCode`; a caller composing this
 * report with something else (`commands/setup.ts`'s `--check` dispatch, for
 * the GitHub-channel health probe) reads `Result.ok` itself and decides
 * what to print/exit with.
 *
 * @param opts.targetDir - The resolved install target (`--claude-dir` >
 *   `$CLAUDE_CONFIG_DIR` > `~/.claude`, resolved by the caller — mirrors
 *   every other mode's `resolveTargetDir` discipline).
 * @param opts.now - Time seam for the cache's `checked_at` (mirrors the
 *   codebase-wide `now: () => string` convention, e.g. `SetupService.install`)
 *   — defaults to `() => new Date().toISOString()`.
 * @param opts.cwd - Directory to start the `setup.check_reminder` team-config
 *   lookup from (walked upward — see `resolveCheckReminderEnabled`). Defaults
 *   to `process.cwd()`. Test seam, mirrors `opts.now`.
 * @throws Never.
 */
export async function computeSetupCheckReport(opts: {
  targetDir: string;
  now?: () => string;
  cwd?: string;
}): Promise<Result<SetupCheckReport, LoreError>> {
  const now = opts.now ?? (() => new Date().toISOString());
  const cwd = opts.cwd ?? process.cwd();

  const manifestResult = readInstalledManifest(opts.targetDir);
  if (!manifestResult.ok) return manifestResult;
  const installed = manifestResult.value;

  const embedded = buildCheckEmbeddedManifest();
  const probe = new RealSetupCheckProbe(opts.targetDir);
  const planResult = planUpdate(embedded, installed, probe);
  if (!planResult.ok) return planResult;
  const plan = planResult.value;

  const report: SetupCheckReport = {
    summary: plan.summary,
    binary_version: LORE_BINARY_VERSION,
    ...(installed?.binary_version !== undefined ? { installed_binary_version: installed.binary_version } : {}),
    ...(installed?.installed_at !== undefined ? { installed_at: installed.installed_at } : {}),
    files: {
      outdated: plan.files.outdated,
      diverged: plan.files.diverged,
      missing: plan.files.missing,
      orphaned: plan.files.orphaned,
    },
  };

  await writeCheckCache(opts.targetDir, report, now(), resolveCheckReminderEnabled(cwd));

  return ok(report);
}

/**
 * Thin printing/exit-code wrapper over {@link computeSetupCheckReport} —
 * runs the full `lore setup --check` flow: computes the report (which does
 * the one permitted write, the check cache — see module doc), then prints
 * text or `--json` output and sets `process.exitCode` (0 sync / 3 stale / a
 * mapped `LoreError` code on a read/parse failure — never a JS exception
 * escaping this function). `commands/setup.ts`'s `--check` dispatch calls
 * this directly for the non-`--json` (human) path only; the `--json` path
 * calls {@link computeSetupCheckReport} directly instead so it can compose
 * this report with the GitHub-channel health probe's report into ONE
 * document (see that file's module doc, "`--check --json` composition").
 *
 * @param opts.targetDir - The resolved install target (`--claude-dir` >
 *   `$CLAUDE_CONFIG_DIR` > `~/.claude`, resolved by the caller — mirrors
 *   every other mode's `resolveTargetDir` discipline).
 * @param opts.json - `--json` flag value.
 * @param opts.now - Time seam for the cache's `checked_at` (mirrors the
 *   codebase-wide `now: () => string` convention, e.g. `SetupService.install`)
 *   — defaults to `() => new Date().toISOString()`.
 * @param opts.cwd - Directory to start the `setup.check_reminder` team-config
 *   lookup from (walked upward — see `resolveCheckReminderEnabled`). Defaults
 *   to `process.cwd()`. Test seam, mirrors `opts.now`.
 * @throws Never.
 */
export async function runSetupCheck(opts: {
  targetDir: string;
  json: boolean;
  now?: () => string;
  cwd?: string;
}): Promise<void> {
  const result = await computeSetupCheckReport(opts);
  if (!result.ok) {
    process.stderr.write(formatError(result.error) + "\n");
    process.exitCode = exitCode(result.error);
    return;
  }
  const report = result.value;

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, data: report }, null, 2));
  } else {
    console.log(renderSetupCheckReport(report, opts.targetDir));
  }
  process.exitCode = report.summary === "sync" ? 0 : 3;
}
