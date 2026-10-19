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
 *     `resolveCheckReminderEnabled` below). **BR-1085**: this ONE shape is
 *     shared by the global cache (`<claude-dir>/.lore-setup-check.json`) and
 *     the project cache (`PROJECT_CHECK_CACHE_RELATIVE_PATH`), additionally
 *     carrying `scope`, the per-state `files` lists and a `reasons` hint
 *     (`SetupCheckReason`: binary version changed / settings changed / hand
 *     edited) — the session-start advisory reads both through it.
 *   - finishProjectSetupCheck(opts) — `lore setup --project --check`'s
 *     finisher: builds the report from the per-state lists
 *     `commands/setup.ts` collected, writes the project cache (its sole
 *     write), prints, sets exit 0 sync / 3 stale.
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
 *     uses, but WITHOUT that helper's `exitCli(1)` on a miss: `--check`
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
import { exitCli } from "./cli-exit.js";
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
import { detectDoubleRegistrations } from "./setup-hook-double-registration.js";
import type { DoubleRegistration } from "./setup-hook-double-registration.js";
import { exitCode, formatErrorFor } from "./utils.js";
import type { Invocation } from "@lore/core";
import { printLine } from "./output.js";
import type { CliIo } from "./output.js";
import type { ExitReport } from "./cli-exit.js";

// ─── On-disk artifact filenames ─────────────────────────────────────────────

/** `<claude-dir>/.lore-setup-check.json` — SPEC-076 §C6's check cache path. */
const CHECK_CACHE_FILENAME = ".lore-setup-check.json";

/** Top-level `assets/` (== install-target) directories a managed-ownership entry can live under. */
const MANAGED_TOP_LEVEL_DIRS = ["skills", "agents", "hooks", "governance"] as const;

// ─── SetupCheckCache — ONE shape for the global AND the project check ──────

/** Which install a check cache describes: the machine install (`<claude-dir>`) or one repo's project scaffold. */
export const SETUP_CHECK_SCOPES = ["global", "project"] as const;

/**
 * WHY a cache is stale — a hint for the session-start advisory (BR-1086), derived from the per-state file lists:
 *   - `binary_version_changed` — an outdated / missing / orphaned file this binary ships or retired;
 *   - `settings_changed`       — a lore entry in the project settings file is missing or out of line (project scope only);
 *   - `hand_edited`            — a diverged file (never advised to be overwritten; the advisory names the files).
 * A cache can carry several; they are always listed in this order.
 */
export const SETUP_CHECK_REASONS = ["binary_version_changed", "settings_changed", "hand_edited"] as const;
export type SetupCheckReason = (typeof SETUP_CHECK_REASONS)[number];

/** Project settings entries appear in the file lists as `<settings file>#<key>`; this marker tells them apart from files. */
const SETTINGS_ENTRY_MARKER = "#";

/** Repo-relative path of the project check cache (the ONLY file `lore setup --project --check` writes). */
export const PROJECT_CHECK_CACHE_RELATIVE_PATH = ".lore/.lore-project-check.json";

/**
 * Zod schema for the persisted check-cache file — SSOT for BOTH caches (BR-1085, consumed by the session-start
 * advisory, task A2):
 *   - global  `<claude-dir>/.lore-setup-check.json`   written by `lore setup --check`           (scope "global")
 *   - project `<repo>/.lore/.lore-project-check.json` written by `lore setup --project --check` (scope "project")
 * `scope` / `files` / `reasons` are optional ONLY so a cache written by a pre-BR-1085 binary still parses (read
 * absent `scope` as "global" and absent `files` as "no detail"); every cache this module writes carries all three.
 */
const setupCheckCacheSchema = z.object({
  /** ISO-8601 timestamp of this check run. */
  checked_at: z.string().min(1),
  /** The binary version that WROTE this cache: the running binary's embedded `LORE_BINARY_VERSION` at check time. */
  binary_version: z.string().min(1),
  status: z.enum(["sync", "stale"]),
  /** Present iff `status === "stale"` — per-state counts for the session-start advisory (orphaned counts live in `files`). */
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
  /** Which install this cache describes. Absent on a legacy cache = `global`. */
  scope: z.enum(SETUP_CHECK_SCOPES).optional(),
  /** Per-state file lists (project: repo-relative POSIX paths; global: claude-dir-relative; settings entries `<file>#<key>`). */
  files: z
    .object({
      outdated: z.array(z.string()),
      diverged: z.array(z.string()),
      missing: z.array(z.string()),
      orphaned: z.array(z.string()),
      /** Absent on a cache written before `retired` existed. */
      retired: z.array(z.string()).optional(),
    })
    .optional(),
  /** Why the install is stale (empty when `status` is `sync`); see {@link SetupCheckReason}. */
  reasons: z.array(z.enum(SETUP_CHECK_REASONS)).optional(),
});

/** Derived TypeScript type for the check-cache file — the shared global/project shape (SPEC-076 §C6 + BR-1085). */
export type SetupCheckCache = z.infer<typeof setupCheckCacheSchema>;

// ─── --json / report shape (SPEC-076 §C3's documented `--json` contract) ──

/** The four non-`sync` freshness buckets `--check`'s report/`--json` surfaces (SPEC-076 §C3). */
export interface SetupCheckFiles {
  outdated: string[];
  diverged: string[];
  missing: string[];
  orphaned: string[];
  /**
   * Tracked by the ledger, no longer shipped, unedited on disk: the next `lore setup --yes` removes them.
   * Present on the GLOBAL report only (the project scaffold has no retire step); absent reads as none.
   */
  retired?: string[];
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
  /**
   * Lore-managed hook files registered for one event at BOTH the user layer and the project
   * layer (each fire runs twice; task-gh-1343388703-157). Present ONLY when non-empty — absence
   * is "none found", and `summary` is `"stale"` whenever this is present. Not part of the check
   * cache: the cache tracks asset freshness, which `lore setup` can repair; this cannot be.
   */
  double_registrations?: DoubleRegistration[];
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
 * ABSENT file (ENOENT only) is the legitimate "fresh target" signal (`ok(null)`); a
 * PRESENT-but-corrupted file is a loud `VALIDATION_ERROR` — see module doc.
 */
function readInstalledManifest(targetDir: string): Result<SetupManifest | null, LoreError> {
  const manifestPath = join(targetDir, MANIFEST_FILENAME);

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (cause) {
    // Only a genuinely ABSENT manifest is a fresh target; any other read failure (permissions,
    // a directory in its place, I/O) must not masquerade as one.
    if (typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "ENOENT") {
      return ok(null);
    }
    return err({
      code: "STORE_ERROR",
      message: `lore setup --check: cannot read the setup manifest at "${manifestPath}": ${describeCaught(cause)}`,
    });
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

/**
 * Derives the stale-reason hint from the per-state lists (see {@link SetupCheckReason}). A settings entry
 * (`<file>#<key>`) in any non-diverged list is `settings_changed`; every other outdated / missing / orphaned
 * file is `binary_version_changed`; any diverged file is `hand_edited`.
 */
export function deriveSetupCheckReasons(files: SetupCheckFiles): SetupCheckReason[] {
  const isSettingsEntry = (path: string): boolean => path.includes(SETTINGS_ENTRY_MARKER);
  const behind = [...files.outdated, ...files.missing, ...files.orphaned, ...(files.retired ?? [])];
  const reasons: SetupCheckReason[] = [];
  if (behind.some((path) => !isSettingsEntry(path))) reasons.push("binary_version_changed");
  if (behind.some(isSettingsEntry)) reasons.push("settings_changed");
  if (files.diverged.length > 0) reasons.push("hand_edited");
  return reasons;
}

function buildCache(
  scope: (typeof SETUP_CHECK_SCOPES)[number],
  report: SetupCheckReport,
  checkedAt: string,
  reminderEnabled: boolean,
): SetupCheckCache {
  const base = {
    checked_at: checkedAt,
    binary_version: report.binary_version,
    status: report.summary,
    ...(reminderEnabled ? {} : { reminder_enabled: false as const }),
    scope,
    files: report.files,
    reasons: deriveSetupCheckReasons(report.files),
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

/** Writes one cache (atomic temp+rename) at `cachePath`; the SOLE write either check performs. */
async function writeCheckCache(
  cachePath: string,
  scope: (typeof SETUP_CHECK_SCOPES)[number],
  report: SetupCheckReport,
  nowIso: string,
  reminderEnabled: boolean,
): Promise<void> {
  const cache = setupCheckCacheSchema.parse(buildCache(scope, report, nowIso, reminderEnabled));
  const writer = new RealSetupFsWriter();
  await writer.write(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

// ─── Text rendering ─────────────────────────────────────────────────────────

function renderSetupCheckReport(
  report: SetupCheckReport,
  targetDir: string,
  scope: (typeof SETUP_CHECK_SCOPES)[number] = "global",
): string {
  const noun = scope === "project" ? "lore project install" : "lore assets";
  const lines: string[] = [
    report.summary === "sync" ? `✓ ${noun} in sync → ${targetDir}` : `✗ ${noun} stale → ${targetDir}`,
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
    ["retired", report.files.retired ?? []],
  ];
  for (const [label, paths] of sections) {
    if (paths.length === 0) continue;
    lines.push("", `${label} (${paths.length}):`);
    for (const path of paths) {
      lines.push(`  ${path}`);
      if (label === "diverged" && scope === "global") {
        lines.push("    repair: lore setup --yes --force-diverged");
      }
      // reason: a project hand edit is never advised to be overwritten (BR-1086) — `lore setup --project` skips it.
      if (label === "diverged" && scope === "project") {
        lines.push("    hand-edited: lore setup --project leaves it as is; review it by hand");
      }
    }
  }
  if (scope === "project" && [report.files.outdated, report.files.missing, report.files.orphaned, report.files.retired ?? []].some((l) => l.length > 0)) {
    lines.push("", "repair outdated / missing / orphaned files: lore setup --project --yes");
  }
  for (const dbl of report.double_registrations ?? []) {
    lines.push(
      "",
      `double registration: ${dbl.file} on ${dbl.event} fires twice`,
      `  user:    ${dbl.user_settings}`,
      `  project: ${dbl.project_settings}`,
      "  repair: remove the project-level registration (lore setup already installs it at user level)",
    );
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
 *   lookup from (walked upward — see `resolveCheckReminderEnabled`): the
 *   Invocation's `cwd`, required (AS-26).
 * @throws Never.
 */
export async function computeSetupCheckReport(opts: {
  targetDir: string;
  now?: () => string;
  cwd: string;
}): Promise<Result<SetupCheckReport, LoreError>> {
  const now = opts.now ?? (() => new Date().toISOString());
  const cwd = opts.cwd;

  const manifestResult = readInstalledManifest(opts.targetDir);
  if (!manifestResult.ok) return manifestResult;
  const installed = manifestResult.value;

  const embedded = buildCheckEmbeddedManifest();
  const probe = new RealSetupCheckProbe(opts.targetDir);
  const planResult = planUpdate(embedded, installed, probe);
  if (!planResult.ok) return planResult;
  const plan = planResult.value;

  const doubleResult = detectDoubleRegistrations({
    claudeDir: opts.targetDir,
    projectDir: findProjectConfigDir(cwd) ?? cwd,
  });
  if (!doubleResult.ok) return doubleResult;
  const doubleRegistrations = doubleResult.value;

  const assetReport: SetupCheckReport = {
    summary: plan.summary,
    binary_version: LORE_BINARY_VERSION,
    ...(installed?.binary_version !== undefined ? { installed_binary_version: installed.binary_version } : {}),
    ...(installed?.installed_at !== undefined ? { installed_at: installed.installed_at } : {}),
    files: {
      outdated: plan.files.outdated,
      diverged: plan.files.diverged,
      missing: plan.files.missing,
      orphaned: plan.files.orphaned,
      retired: plan.files.retired,
    },
  };

  // The cache records ASSET freshness only (its `stale` drives the session-start "run lore setup" advisory).
  await writeCheckCache(
    join(opts.targetDir, CHECK_CACHE_FILENAME),
    "global",
    assetReport,
    now(),
    resolveCheckReminderEnabled(cwd),
  );

  if (doubleRegistrations.length === 0) return ok(assetReport);
  return ok({ ...assetReport, summary: "stale", double_registrations: doubleRegistrations });
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
 *   lookup from (walked upward — see `resolveCheckReminderEnabled`): the
 *   Invocation's `cwd`, required (AS-26).
 * @throws Never.
 */
export async function runSetupCheck(opts: {
  targetDir: string;
  json: boolean;
  now?: () => string;
  cwd: string;
  inv: Invocation;
}): Promise<ExitReport> {
  const result = await computeSetupCheckReport(opts);
  if (!result.ok) {
    opts.inv.io.stderr.write(formatErrorFor(opts.inv, result.error) + "\n");
    return exitCode(result.error);
  }
  const report = result.value;

  if (opts.json) {
    printLine(opts.inv.io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
  } else {
    printLine(opts.inv.io.stdout, renderSetupCheckReport(report, opts.targetDir));
  }
  return report.summary === "sync" ? 0 : 3;
}

// ─── Project check (BR-1085): collected by the caller, finished here ────────

/**
 * Finishes `lore setup --project --check`: builds the report from the per-state lists the caller collected
 * (ledger hooks/skills, lore rules files, project settings entries), writes the project check cache — the
 * run's ONLY write, at {@link PROJECT_CHECK_CACHE_RELATIVE_PATH} — then prints text or `--json` and sets
 * `process.exitCode` (0 in sync / 3 otherwise). Lists are de-duplicated and sorted so two runs over an
 * unchanged tree print and cache identical bytes.
 *
 * @param opts.repoDir - Absolute repo root (the cache lands under its `.lore/`).
 * @param opts.files - Per-state repo-relative POSIX paths; settings entries as `<file>#<key>`.
 * @param opts.json - `--json` flag value.
 * @param opts.now - Time seam for the cache's `checked_at`.
 * @throws Never — a cache write failure is printed to stderr with exit 1.
 */
export async function finishProjectSetupCheck(io: CliIo, opts: {
  repoDir: string;
  files: SetupCheckFiles;
  json: boolean;
  now?: () => string;
}): Promise<ExitReport> {
  const tidy = (paths: string[]): string[] => [...new Set(paths)].sort();
  const files: SetupCheckFiles = {
    outdated: tidy(opts.files.outdated),
    diverged: tidy(opts.files.diverged),
    missing: tidy(opts.files.missing),
    orphaned: tidy(opts.files.orphaned),
  };
  const inSync = Object.values(files).every((paths) => paths.length === 0);
  const report: SetupCheckReport = {
    summary: inSync ? "sync" : "stale",
    binary_version: LORE_BINARY_VERSION,
    files,
  };

  const cachePath = join(opts.repoDir, PROJECT_CHECK_CACHE_RELATIVE_PATH);
  try {
    await writeCheckCache(
      cachePath,
      "project",
      report,
      (opts.now ?? (() => new Date().toISOString()))(),
      resolveCheckReminderEnabled(opts.repoDir),
    );
  } catch (cause) {
    io.stderr.write(`Error: lore setup --project --check could not write its cache at ${cachePath}: ${describeCaught(cause)}\n`);
    return 1;
  }

  if (opts.json) {
    printLine(io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
  } else {
    printLine(io.stdout, renderSetupCheckReport(report, opts.repoDir, "project"));
  }
  return inSync ? 0 : 3;
}
