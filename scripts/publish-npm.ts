#!/usr/bin/env bun
/**
 * scripts/publish-npm.ts — npm single-platform publish pipeline ORCHESTRATOR
 * (SPEC-048 Scope IN #2, Design "Pipeline stages" a-d, D9). Repo-side tooling,
 * NEVER shipped in the npm tarball (staged package.json's `files` allowlist
 * never references this path — see `packages/lore/src/distribution/assemble.ts`).
 *
 * Public surface (imported by the unit test via a dynamic, non-literal-specifier
 * `import()` — see `packages/lore/tests/unit/distribution/publish-pipeline.test.ts`
 * for why a static import from a `packages/lore/tsconfig.tests.json`-scoped test
 * file is not possible, mirroring `platform-map.test.ts`'s established workaround):
 *   - parseArgs(argv) — pure flag parser: `--publish`, `--tag <dist-tag>`,
 *     `--registry <url>`, `--pack-only`. Never throws; returns a Result.
 *   - runPipeline(flags, deps) — pure SEQUENCING/decision logic over an
 *     injected `PipelineDeps` bundle. Every side-effecting concern (build,
 *     assemble+stage, verify, npm pack/publish) is a constructor-injected
 *     function/port — this function itself does no IO, so the unit test
 *     exercises real orchestration logic (ordering, short-circuit-on-failure,
 *     the D9 "no npmPublish without --publish" invariant) with zero
 *     filesystem/network/subprocess activity.
 *   - Publisher / PipelineDeps / PublishNpmFlags / VerifyReport / PackResult /
 *     PipelineReport — the injected-port and data shapes.
 *
 * Design (mirrors `packages/lore/src/adapters/real-mcp-registrar.ts`'s
 * "one real implementation behind an injected port" shape, SPEC-046 P1
 * precedent):
 *   - The REAL implementations (`realBuild`/`realAssemble`/`realVerify`/
 *     `RealPublisher`) live in this same file (this task's file anchors are
 *     `scripts/publish-npm.ts` + its own test — no new file elsewhere) and are
 *     wired ONLY inside `main()`, which runs ONLY when this file is the
 *     process entry point (`import.meta.main` — Bun's `require.main`-shaped
 *     boolean; `undefined`/falsy under vitest's Node/Vite dynamic-import
 *     context, so importing this module for its pure exports never triggers
 *     a real build/pack/publish).
 *   - `node:child_process.spawn`, NOT `Bun.spawn` — the global `Bun` object is
 *     absent inside vitest's worker-thread pool (same rationale as
 *     `real-mcp-registrar.ts`'s module doc; this module's OWN unit test runs
 *     under `bunx vitest`, and while it never exercises the real spawns, the
 *     module must still type-check and load cleanly there).
 *   - `runPipeline` NEVER calls `deps.publisher.npmPublish` unless
 *     `flags.publish === true` (D9 — bare invocation is dry-run). This is the
 *     single most important invariant in this file: the ambient environment
 *     this pipeline runs in may carry REAL, valid npm registry credentials
 *     (`~/.npmrc`) — an accidental unconditional publish call would be a live,
 *     irreversible action, not a test artifact.
 *   - `deps.publisher.npmPack` is called ONLY when `flags.packOnly === true`
 *     (the D2 beta-artifact-emission path) — the stage-c verification
 *     step's OWN internal (real-impl-only) pack-to-scratch-dir-then-delete
 *     for the `tar -tvf` exec-bit assertion is a SEPARATE, always-run,
 *     non-Publisher-routed concern (part of `deps.verify`, not
 *     `deps.publisher`) — so a bare/dry-run invocation's fake Publisher in
 *     the unit test observes ZERO calls to either of its methods, and the
 *     REAL invocation's on-disk artifact set stays empty unless the user
 *     explicitly asked for one.
 *
 * Side-effect class: pure (`parseArgs`, `runPipeline`) + IO (everything under
 * `main()` — subprocess spawns, filesystem staging, npm invocations).
 * Source: SPEC-048 Scope IN #2; Design "Pipeline stages (a)-(d)", D2, D9;
 * task AC-048-A (unit oracle), AC-048-B (bare dry-run integration oracle).
 */

import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { err, ok } from "@lore/core";
import type { Result, LoreError } from "@lore/core";

import { resolvePlatform } from "./platform-map.js";
import {
  buildPublishPlan,
  mergeShippedAssetFiles,
  README_SOURCE_PATH,
  type PublishPlan,
} from "../packages/lore/src/distribution/assemble.js";
import { RealAssetSource, RETIRED_FROM_INSTALL_PATHS, listBinaryReadAssetPaths } from "../packages/lore/src/adapters/real-asset-source.js";
import { formatError } from "../packages/lore/src/adapters/cli/utils.js";

/** Repo root, resolved from this file's own location (works whether invoked via `bun run` or a dynamic test import). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Tarball size tripwire (SPEC-048 Design stage c, Risks table "Tarball size creep"). */
const MAX_TARBALL_BYTES = 150 * 1024 * 1024;

/** Default `npm publish`/`npm pack` dist-tag when `--tag` is omitted — the D2 beta channel default. */
const DEFAULT_TAG = "beta";

/** Owner-execute bit position in a `tar -tvf` mode string (e.g. `-rwxr-xr-x`), 0-indexed. */
const TAR_MODE_OWNER_EXEC_INDEX = 3;

// ─── Flag parsing (pure) ──────────────────────────────────────────────────

/** Parsed, fully-resolved CLI flags for this script. */
export interface PublishNpmFlags {
  /** `--publish` — gates stage (d), the ONLY irreversible stage (D9). */
  publish: boolean;
  /** `--pack-only` — emits the beta tarball artifact via a real `npm pack` (D2). */
  packOnly: boolean;
  /** `--tag <dist-tag>` — resolved dist-tag, defaults to {@link DEFAULT_TAG}. */
  tag: string;
  /** `--registry <url>` — resolved registry override, when passed. */
  registry?: string;
}

/**
 * Parses this script's argv (i.e. `process.argv.slice(2)`) into
 * {@link PublishNpmFlags}. Pure — never throws, never reads `process.env`
 * or the filesystem.
 *
 * @param argv - Raw argument tokens (no program name / script path).
 * @returns `ok(flags)` on a well-formed argv, else `err(VALIDATION_ERROR)`
 *   naming the first offending token (an unknown flag, or a value-taking
 *   flag missing its value).
 * @example
 * parseArgs([]); // => ok({ publish: false, packOnly: false, tag: "beta" })
 * parseArgs(["--publish", "--tag", "latest"]);
 * // => ok({ publish: true, packOnly: false, tag: "latest" })
 */
export function parseArgs(argv: string[]): Result<PublishNpmFlags, LoreError> {
  let publish = false;
  let packOnly = false;
  let tag: string | undefined;
  let registry: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--publish":
        publish = true;
        break;
      case "--pack-only":
        packOnly = true;
        break;
      case "--tag": {
        const value = argv[i + 1];
        if (value === undefined) {
          return err({
            code: "VALIDATION_ERROR",
            field: "tag",
            message: "--tag requires a value (e.g. --tag beta)",
            value: undefined,
          });
        }
        tag = value;
        i++;
        break;
      }
      case "--registry": {
        const value = argv[i + 1];
        if (value === undefined) {
          return err({
            code: "VALIDATION_ERROR",
            field: "registry",
            message: "--registry requires a value (e.g. --registry https://registry.npmjs.org)",
            value: undefined,
          });
        }
        registry = value;
        i++;
        break;
      }
      default:
        return err({
          code: "VALIDATION_ERROR",
          field: "argv",
          message: `Unknown argument: "${arg}". Known flags: --publish, --tag <dist-tag>, --registry <url>, --pack-only`,
          value: arg,
        });
    }
  }

  return ok({
    publish,
    packOnly,
    tag: tag ?? DEFAULT_TAG,
    ...(registry !== undefined ? { registry } : {}),
  });
}

// ─── Injected ports ────────────────────────────────────────────────────────

/** Outcome of a real (non-dry-run) `npm pack` — used both by stage c's internal verification pack and by the `--pack-only` artifact emission. */
export interface PackResult {
  /** Absolute path of the produced `.tgz`. */
  tarballPath: string;
  /** On-disk size of the produced `.tgz`, in bytes. */
  sizeBytes: number;
}

/** Stage-c verification outcome. */
export interface VerifyReport {
  /** stdout of the staged binary's `--version` smoke check. */
  version: string;
  /** Repo-relative file paths `npm pack --dry-run --json` reports it would include. */
  packFiles: string[];
  /** Size of a real (scratch, deleted-after-use) pack of the staged package — the stage-c size tripwire input. */
  tarballSizeBytes: number;
}

/**
 * The two real npm invocations this pipeline ever performs OUTSIDE of
 * verification. Injected so the orchestration logic is testable with a fake
 * that asserts call/no-call rather than exercising a real npm registry.
 */
export interface Publisher {
  /** Real `npm pack` (D2 beta artifact emission) — writes a `.tgz` for the given plan and returns its path/size. */
  npmPack(plan: PublishPlan): Promise<Result<PackResult, LoreError>>;
  /** Real `npm publish` (stage d) — the ONLY irreversible action this whole pipeline can take. */
  npmPublish(plan: PublishPlan, opts: { tag: string; registry?: string }): Promise<Result<void, LoreError>>;
}

/**
 * Every side-effecting stage this pipeline sequences, as injected functions.
 * `runPipeline` never calls `node:fs`/`node:child_process` itself — it only
 * calls into these.
 */
export interface PipelineDeps {
  /** Stage (a): `bun run build` for the current platform. */
  build: () => Promise<Result<void, LoreError>>;
  /** Stage (b): compute the `PublishPlan` (platform-map + `buildPublishPlan`) AND physically stage every file to disk. */
  assemble: () => Promise<Result<PublishPlan, LoreError>>;
  /** Stage (c): staged-binary smoke, `lore setup --dry-run` against staged assets, `npm pack --dry-run` file-list check, `tar -tvf` exec-bit + size tripwire. */
  verify: (plan: PublishPlan) => Promise<Result<VerifyReport, LoreError>>;
  /** Stage (d) + `--pack-only` artifact emission — the only real-npm-registry-or-tarball-producing port. */
  publisher: Publisher;
}

/** Full, successful pipeline outcome. */
export interface PipelineReport {
  plan: PublishPlan;
  verify: VerifyReport;
  packed?: PackResult;
  published: boolean;
}

/**
 * Runs the publish pipeline's stage sequencing over an injected
 * {@link PipelineDeps} bundle. PURE decision logic — no IO of its own.
 *
 * Sequencing (short-circuits on the first stage that returns `err`,
 * mirroring every other Result-chain in this codebase):
 *   1. `deps.build()` — stage (a).
 *   2. `deps.assemble()` — stage (b); its `PublishPlan` result feeds every
 *      later stage.
 *   3. `deps.verify(plan)` — stage (c).
 *   4. `flags.packOnly` → `deps.publisher.npmPack(plan)` (real artifact
 *      emission; SKIPPED entirely when `packOnly` is false — see module doc).
 *   5. `flags.publish` → `deps.publisher.npmPublish(plan, {tag, registry})`
 *      (stage d; SKIPPED entirely when `publish` is false — D9, the single
 *      most important invariant in this file).
 *
 * @param flags - Parsed CLI flags (see {@link parseArgs}).
 * @param deps - Injected stage implementations (real in `main()`, fakes in tests).
 * @returns `ok(report)` when every required stage succeeds, else the first
 *   stage's own `err(...)` verbatim (never wrapped/re-coded).
 * @example
 * await runPipeline(
 *   { publish: false, packOnly: false, tag: "beta" },
 *   fakeDeps
 * );
 * // → fakeDeps.publisher.npmPack/npmPublish are NEVER invoked.
 */
export async function runPipeline(
  flags: PublishNpmFlags,
  deps: PipelineDeps
): Promise<Result<PipelineReport, LoreError>> {
  const buildResult = await deps.build();
  if (!buildResult.ok) return buildResult;

  const assembleResult = await deps.assemble();
  if (!assembleResult.ok) return assembleResult;
  const plan = assembleResult.value;

  const verifyResult = await deps.verify(plan);
  if (!verifyResult.ok) return verifyResult;

  let packed: PackResult | undefined;
  if (flags.packOnly) {
    const packResult = await deps.publisher.npmPack(plan);
    if (!packResult.ok) return packResult;
    packed = packResult.value;
  }

  if (flags.publish) {
    const publishResult = await deps.publisher.npmPublish(plan, {
      tag: flags.tag,
      ...(flags.registry !== undefined ? { registry: flags.registry } : {}),
    });
    if (!publishResult.ok) return publishResult;
  }

  return ok({
    plan,
    verify: verifyResult.value,
    ...(packed !== undefined ? { packed } : {}),
    published: flags.publish,
  });
}

// ─── Real implementations (wired only by main(); never exercised under vitest) ──

/** Renders any thrown value as a diagnostic string. Mirrors `real-asset-source.ts`'s `describeCaught`. */
function describeCaught(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** A completed subprocess's collected output. */
interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawns `cmd args` and collects its output, resolving once the process
 * closes. Never rejects — a spawn error (e.g. ENOENT) resolves with
 * `exitCode: -1` and the error message folded into `stderr`, mirroring
 * `real-mcp-registrar.ts`'s "never throws" port contract.
 */
function spawnCollect(cmd: string, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });
    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (cause) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: -1, stdout, stderr: stderr || describeCaught(cause) });
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: exitCode ?? -1, stdout, stderr });
    });
  });
}

/** Stage (a): `bun run build` for the current platform (SPEC-048 Design, unchanged contract). */
async function realBuild(): Promise<Result<void, LoreError>> {
  const result = await spawnCollect("bun", ["run", "build"], REPO_ROOT);
  if (result.exitCode !== 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "build",
      message: `"bun run build" exited ${result.exitCode}: ${result.stderr.slice(0, 2000)}`,
      value: result.exitCode,
    });
  }
  return ok(undefined);
}

/** Reads `packages/lore/package.json`'s `version` field — the workspace version the generated npm manifest locks to (SPEC-048 Scope IN #5). */
function readWorkspaceVersion(): Result<string, LoreError> {
  const pkgJsonPath = join(REPO_ROOT, "packages", "lore", "package.json");
  try {
    const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version?: unknown };
    if (typeof parsed.version !== "string" || parsed.version.trim().length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "version",
        message: `${pkgJsonPath} has no valid "version" string field`,
        value: parsed.version,
      });
    }
    return ok(parsed.version);
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message: `Failed to read/parse ${pkgJsonPath}: ${describeCaught(cause)}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }
}

/** Physically stages every file `plan.stagingFiles` + `plan.packageJson` + the README describes, `chmod +x`-ing the binary. */
function stageFilesToDisk(plan: PublishPlan): Result<void, LoreError> {
  try {
    for (const [dest, src] of Object.entries(plan.stagingFiles)) {
      const destAbs = join(REPO_ROOT, dest);
      mkdirSync(dirname(destAbs), { recursive: true });
      copyFileSync(join(REPO_ROOT, src), destAbs);
    }

    // README is part of packageJson.files but deliberately NOT part of
    // buildPublishPlan's stagingFiles map (see assemble.ts's own doc) — the
    // orchestrator stages it directly from the fixed repo-root README.
    const readmeDest = join(REPO_ROOT, plan.stagingRoot, "README.md");
    mkdirSync(dirname(readmeDest), { recursive: true });
    copyFileSync(join(REPO_ROOT, README_SOURCE_PATH), readmeDest);

    const binaryDest = join(REPO_ROOT, plan.stagingRoot, "dist", "lore");
    chmodSync(binaryDest, 0o755);

    const packageJsonDest = join(REPO_ROOT, plan.stagingRoot, "package.json");
    writeFileSync(packageJsonDest, `${JSON.stringify(plan.packageJson, null, 2)}\n`, "utf8");

    return ok(undefined);
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message: `Failed to stage publish plan at ${plan.stagingRoot}: ${describeCaught(cause)}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }
}

/**
 * Stage (b): computes the `PublishPlan` (current platform, workspace
 * version, the SAME `assets/{skills,agents,hooks,governance}` tree (plus the
 * binary-read `assets/context/**`, via `mergeShippedAssetFiles`)
 * `RealAssetSource` walks for `lore setup` — reused here rather than
 * re-implemented, so "which assets ship" has exactly one SSOT) and
 * physically stages it to `dist-npm/<pkg>-<target>/`.
 */
async function realAssemble(): Promise<Result<PublishPlan, LoreError>> {
  const versionResult = readWorkspaceVersion();
  if (!versionResult.ok) return versionResult;

  const platform = resolvePlatform();

  const assetSource = new RealAssetSource(join(REPO_ROOT, "assets"));
  const loaded = await assetSource.load();
  if (!loaded.ok) return loaded;
  // `RealAssetSource.load()` appends one SYNTHETIC `kind: "settings-hook"`
  // entry (`settings.json`, the lore-setup hook-registration payload,
  // SPEC-046 2026-07-20 amendment) that has no corresponding real file on
  // disk under `assets/` — it is install-time-COMPUTED policy content
  // (`@lore/core`'s `buildHookSettingsEntries`), not a packageable asset
  // file. Filter it out before mapping to `copyFileSync` source paths, or
  // staging fails loud with ENOENT on `assets/settings.json`.
  const assetFiles = loaded.value.files
    .filter((file) => file.kind !== "settings-hook")
    .map((file) => `assets/${file.path}`);

  // SPEC-085 D3 byproduct fix: `RealAssetSource.load()`'s payload is the
  // MACHINE INSTALL SET view — it deliberately EXCLUDES files retired from
  // `<claude-dir>/...` installation (`RETIRED_FROM_INSTALL_PATHS`:
  // the governance files named in real-asset-source.ts:RETIRED_FROM_INSTALL_PATHS). But the
  // npm package's OWN `assets/` tree is a SEPARATE concern: the bootstrap-
  // stage `lore governance` verb (and its `--seat-briefing` flag) reads
  // these exact files directly off the BINARY'S OWN assets root at runtime
  // (`resolveAssetsRoot`/`readGovernanceAsset`), completely independent of
  // what `lore setup` ever installs. Reusing the install-set list verbatim
  // for "what ships in the package" would silently ship an npm package
  // whose `lore governance` verb 404s (VALIDATION_ERROR, exit 4) on a real
  // install — SPEC-085 D3 surfaced this because retiring the SECOND
  // (last-remaining) governance file emptied the directory entirely,
  // turning a previously-silent one-file gap into a hard ENOENT during
  // `lore setup --dry-run` staging verification. The retired files are
  // added back here, explicitly, so "which files are installed" and "which
  // files ship inside the package" stay two independently correct answers
  // over the SAME assets/ tree.
  // The binary-read set is wider than the retired governance files: `assets/context/**`
  // fragments (kind `context`, spec-context-fragments-config-driven-layered-rule-
  // injection D9) are read off the binary's own assets root too and are never in
  // the install set. `mergeShippedAssetFiles` (assemble.ts) is the single union.
  const shippedAssetFiles = mergeShippedAssetFiles({
    installSetAssetFiles: assetFiles,
    retiredFromInstallPaths: RETIRED_FROM_INSTALL_PATHS,
    binaryReadAssetPaths: listBinaryReadAssetPaths(join(REPO_ROOT, "assets")),
  });

  const planResult = buildPublishPlan({
    version: versionResult.value,
    platform,
    assetFiles: shippedAssetFiles,
    binaryPath: "dist/lore",
  });
  if (!planResult.ok) return planResult;
  const plan = planResult.value;

  const stageResult = stageFilesToDisk(plan);
  if (!stageResult.ok) return stageResult;

  return ok(plan);
}

/** Parses one `tar -tvf` output line's leading mode token (e.g. `-rwxr-xr-x`) and reports whether the owner-execute bit is set. */
function tarModeHasOwnerExec(modeToken: string): boolean {
  return modeToken.length > TAR_MODE_OWNER_EXEC_INDEX && modeToken[TAR_MODE_OWNER_EXEC_INDEX] === "x";
}

/**
 * Parses a real (non-dry-run) `npm pack --json` stdout payload and extracts
 * the produced tarball's `filename`. Shared by `realVerify`'s scratch pack
 * and `RealPublisher.npmPack`'s artifact-emission pack — both invoke the
 * SAME `npm pack --json` shape and need the SAME field. Never throws: an
 * empty array or a JSON parse failure both resolve to a described
 * `VALIDATION_ERROR`, never an exception the caller must remember to catch.
 *
 * @param stdout - Raw stdout from a `npm pack --json` invocation.
 * @param field - The `LoreError.field` to attribute a failure to (callers
 *   use distinct values so the error is traceable to its call site).
 * @returns `ok(filename)` on a well-formed non-empty array, else
 *   `err(VALIDATION_ERROR)` naming the truncated raw stdout.
 */
function parseNpmPackFilename(stdout: string, field: string): Result<string, LoreError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    return err({
      code: "VALIDATION_ERROR",
      field,
      message: `"npm pack --json" produced unparsable output: ${describeCaught(cause)}`,
      value: stdout.slice(0, 500),
    });
  }
  const first = Array.isArray(parsed) ? (parsed[0] as { filename?: unknown } | undefined) : undefined;
  if (!first || typeof first.filename !== "string") {
    return err({
      code: "VALIDATION_ERROR",
      field,
      message: `"npm pack --json" output has no entries (expected a one-element array with a "filename" field)`,
      value: stdout.slice(0, 500),
    });
  }
  return ok(first.filename);
}

/**
 * Stage (c): staged-binary `--version` smoke, `lore setup --dry-run` against
 * the STAGED assets tree (proves sibling-assets resolution in the npm
 * layout), `npm pack --dry-run` file-list check, and a real (scratch,
 * deleted-after-use) `npm pack` + `tar -tvf` exec-bit assertion + size
 * tripwire. `--no-audit --fund=false` on every npm invocation — empirically
 * verified (2026-07-17, `npm 11.9.0`) to avoid a registry round-trip that can
 * otherwise hang in a sandboxed/offline environment.
 */
async function realVerify(plan: PublishPlan): Promise<Result<VerifyReport, LoreError>> {
  const stagingRootAbs = join(REPO_ROOT, plan.stagingRoot);
  const binPath = join(stagingRootAbs, "dist", "lore");

  // 1. Staged binary --version smoke.
  const versionResult = await spawnCollect(binPath, ["--version"], stagingRootAbs);
  if (versionResult.exitCode !== 0 || versionResult.stdout.trim().length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "verify.version",
      message: `Staged binary "--version" smoke failed (exit ${versionResult.exitCode}): ${versionResult.stderr.slice(0, 1000)}`,
      value: versionResult.exitCode,
    });
  }

  // 2. `lore setup --dry-run` against the STAGED assets tree.
  const tmpClaudeDir = mkdtempSync(join(tmpdir(), "lore-publish-verify-claude-"));
  try {
    const setupResult = await spawnCollect(binPath, ["setup", "--dry-run", "--claude-dir", tmpClaudeDir], stagingRootAbs);
    if (setupResult.exitCode !== 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "verify.setup-dry-run",
        message: `"lore setup --dry-run" against the staged package failed (exit ${setupResult.exitCode}): ${setupResult.stderr.slice(0, 1000)}`,
        value: setupResult.exitCode,
      });
    }
  } finally {
    rmSync(tmpClaudeDir, { recursive: true, force: true });
  }

  // 3. `npm pack --dry-run --json` file-list check.
  const dryRunPack = await spawnCollect(
    "npm",
    ["pack", "--dry-run", "--json", "--no-audit", "--fund=false"],
    stagingRootAbs
  );
  if (dryRunPack.exitCode !== 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "verify.npm-pack-dry-run",
      message: `"npm pack --dry-run" failed (exit ${dryRunPack.exitCode}): ${dryRunPack.stderr.slice(0, 1000)}`,
      value: dryRunPack.exitCode,
    });
  }
  let packFiles: string[];
  try {
    const parsed = JSON.parse(dryRunPack.stdout) as Array<{ files: Array<{ path: string }> }>;
    packFiles = (parsed[0]?.files ?? []).map((f) => f.path);
  } catch (cause) {
    return err({
      code: "VALIDATION_ERROR",
      field: "verify.npm-pack-dry-run",
      message: `"npm pack --dry-run --json" produced unparsable output: ${describeCaught(cause)}`,
      value: dryRunPack.stdout.slice(0, 500),
    });
  }
  const allowedPrefixes = ["dist/lore", "assets/", "postinstall.mjs", "README.md", "package.json"];
  const unexpected = packFiles.filter((path) => !allowedPrefixes.some((prefix) => path === prefix || path.startsWith(prefix)));
  if (unexpected.length > 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "verify.npm-pack-dry-run",
      message: `"npm pack --dry-run" would include unexpected file(s) outside the allowlist: ${unexpected.join(", ")}`,
      value: unexpected,
    });
  }
  if (!packFiles.includes("dist/lore")) {
    return err({
      code: "VALIDATION_ERROR",
      field: "verify.npm-pack-dry-run",
      message: `"npm pack --dry-run" file list is missing "dist/lore"`,
      value: packFiles,
    });
  }

  // 4. Real (scratch) pack + `tar -tvf` exec-bit assertion + size tripwire.
  const scratchDir = mkdtempSync(join(tmpdir(), "lore-publish-verify-pack-"));
  try {
    const realPack = await spawnCollect(
      "npm",
      ["pack", "--pack-destination", scratchDir, "--json", "--no-audit", "--fund=false"],
      stagingRootAbs
    );
    if (realPack.exitCode !== 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "verify.npm-pack",
        message: `"npm pack" (scratch verification copy) failed (exit ${realPack.exitCode}): ${realPack.stderr.slice(0, 1000)}`,
        value: realPack.exitCode,
      });
    }
    const filenameResult = parseNpmPackFilename(realPack.stdout, "verify.npm-pack");
    if (!filenameResult.ok) return filenameResult;
    const tgzPath = join(scratchDir, filenameResult.value);

    const tarResult = await spawnCollect("tar", ["-tvf", tgzPath], scratchDir);
    if (tarResult.exitCode !== 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "verify.tar",
        message: `"tar -tvf" on the scratch verification tarball failed (exit ${tarResult.exitCode}): ${tarResult.stderr.slice(0, 1000)}`,
        value: tarResult.exitCode,
      });
    }
    const loreLine = tarResult.stdout.split("\n").find((line) => line.includes("dist/lore"));
    if (!loreLine) {
      return err({
        code: "VALIDATION_ERROR",
        field: "verify.tar",
        message: `"tar -tvf" output has no "dist/lore" entry`,
        value: tarResult.stdout.slice(0, 500),
      });
    }
    const modeToken = loreLine.trim().split(/\s+/)[0] ?? "";
    if (!tarModeHasOwnerExec(modeToken)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "verify.tar",
        message: `Packed "dist/lore" is missing the owner-execute bit (mode "${modeToken}")`,
        value: modeToken,
      });
    }

    let sizeBytes: number;
    try {
      sizeBytes = statSync(tgzPath).size;
    } catch (cause) {
      return err({
        code: "STORE_ERROR",
        message: `Failed to stat scratch verification tarball ${tgzPath}: ${describeCaught(cause)}`,
        ...(cause instanceof Error ? { cause } : {}),
      });
    }
    if (sizeBytes >= MAX_TARBALL_BYTES) {
      return err({
        code: "VALIDATION_ERROR",
        field: "verify.size",
        message: `Packed tarball size ${sizeBytes} bytes exceeds the ${MAX_TARBALL_BYTES}-byte tripwire`,
        value: sizeBytes,
      });
    }

    return ok({ version: versionResult.stdout.trim(), packFiles, tarballSizeBytes: sizeBytes });
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

/** `node:child_process`-backed {@link Publisher}. Mirrors `real-mcp-registrar.ts`'s port shape. */
class RealPublisher implements Publisher {
  async npmPack(plan: PublishPlan): Promise<Result<PackResult, LoreError>> {
    const stagingRootAbs = join(REPO_ROOT, plan.stagingRoot);
    const destination = join(REPO_ROOT, "dist-npm", "artifacts");
    mkdirSync(destination, { recursive: true });

    const result = await spawnCollect(
      "npm",
      ["pack", "--pack-destination", destination, "--json", "--no-audit", "--fund=false"],
      stagingRootAbs
    );
    if (result.exitCode !== 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "npm pack",
        message: `"npm pack" exited ${result.exitCode}: ${result.stderr.slice(0, 1000)}`,
        value: result.exitCode,
      });
    }
    const filenameResult = parseNpmPackFilename(result.stdout, "npm pack");
    if (!filenameResult.ok) return filenameResult;
    const tarballPath = join(destination, filenameResult.value);
    let sizeBytes: number;
    try {
      sizeBytes = statSync(tarballPath).size;
    } catch (cause) {
      return err({
        code: "STORE_ERROR",
        message: `Failed to stat produced tarball ${tarballPath}: ${describeCaught(cause)}`,
        ...(cause instanceof Error ? { cause } : {}),
      });
    }
    return ok({ tarballPath, sizeBytes });
  }

  async npmPublish(plan: PublishPlan, opts: { tag: string; registry?: string }): Promise<Result<void, LoreError>> {
    const stagingRootAbs = join(REPO_ROOT, plan.stagingRoot);
    const args = ["publish", "--tag", opts.tag];
    if (opts.registry !== undefined) {
      args.push("--registry", opts.registry);
    }
    const result = await spawnCollect("npm", args, stagingRootAbs);
    if (result.exitCode !== 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "npm publish",
        message: `"npm publish" exited ${result.exitCode}: ${result.stderr.slice(0, 1000)}`,
        value: result.exitCode,
      });
    }
    return ok(undefined);
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

/** Real `PipelineDeps` — the only place `main()` wires actual IO. */
function realDeps(): PipelineDeps {
  return {
    build: realBuild,
    assemble: realAssemble,
    verify: realVerify,
    publisher: new RealPublisher(),
  };
}

async function main(): Promise<void> {
  const flagsResult = parseArgs(process.argv.slice(2));
  if (!flagsResult.ok) {
    console.error(`[publish-npm] ${formatError(flagsResult.error)}`);
    process.exit(2);
  }
  const flags = flagsResult.value;

  console.log(
    `[publish-npm] starting (publish=${flags.publish}, packOnly=${flags.packOnly}, tag=${flags.tag}` +
      `${flags.registry !== undefined ? `, registry=${flags.registry}` : ""})`
  );

  const result = await runPipeline(flags, realDeps());
  if (!result.ok) {
    console.error(`[publish-npm] FAILED: ${formatError(result.error)}`);
    process.exit(1);
  }

  const { plan, verify, packed, published } = result.value;
  console.log(`[publish-npm] staged: ${plan.stagingRoot} (${plan.packageName}@${plan.packageJson.version})`);
  console.log(`[publish-npm] verify: version=${verify.version}, tarballSizeBytes=${verify.tarballSizeBytes}, files=${verify.packFiles.length}`);
  if (packed) {
    console.log(`[publish-npm] packed artifact: ${packed.tarballPath} (${packed.sizeBytes} bytes)`);
  }
  console.log(`[publish-npm] published=${published}`);
  process.exit(0);
}

if (import.meta.main) {
  main().catch((cause) => {
    console.error(`[publish-npm] unexpected error: ${describeCaught(cause)}`);
    process.exit(1);
  });
}
