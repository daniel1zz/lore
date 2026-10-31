// @spawns-external git asks `git check-ignore` whether the scratch namespace is ignored
// @spawns-external tsc type-checks a throwaway fixture project
// @reads package.json
// @reads packages/**
// @reads tsconfig.json
/** @spec_ref AC-OX-3 */
/**
 * Static assertion suite for the `.scratch/` probe/negative-control
 * namespace (`spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check`,
 * D4 / AC-OX-3) — proves BOTH halves of the isolation contract WITHOUT ever
 * writing into a real typechecked glob in this checkout:
 *
 *   (a) `.scratch/` is gitignored, and falls outside every one of this
 *       repo's `bun run typecheck:*` tsconfig projects' `include` globs.
 *       The seven projects are ENUMERATED from root `package.json`'s own
 *       `typecheck:*` scripts (never a hardcoded list of tsconfig paths) —
 *       `resolveTsconfigPathForScript` below extracts each script's
 *       `-p <path>` flag, or, for the one script that delegates via bun's
 *       `--filter '<pkg>'` (`typecheck:dashboard`), resolves the target
 *       workspace package's own `typecheck` script and recurses. A
 *       hardcoded list would silently stop covering a project added later —
 *       the exact failure mode the spec calls out.
 *   (b) the compile-error DISCRIMINATION power this whole probe convention
 *       depends on (a detected error vs. a config fatal that checked
 *       nothing) is proven in TWO fully isolated, `mkdtemp`-created tsc
 *       projects — never inside this checkout's own typechecked trees.
 *
 * ⛔ **Second-order correction, recorded here because it reverses this
 * file's own first version.** That version "corrected" the governing spec's
 * `tsc --noEmit` exit-1-for-a-real-error claim to exit 1 vs 2, based on a
 * probe run through `bunx tsc` — which downloads its OWN TypeScript into a
 * temp lockfile, never the compiler `bun run typecheck` actually invokes.
 * Re-measured against THIS repo's `node_modules/.bin/tsc` (TypeScript
 * 5.9.3) — the coordinator's independent re-measurement matched exactly,
 * citing `node_modules/typescript/lib/_tsc.js:128844-128849`
 * (`emitFilesAndReportErrorsAndGetExitStatus`):
 *
 *   | tsconfig shape                                  | case          | exit | error    |
 *   |--------------------------------------------------|---------------|------|----------|
 *   | `noEmit: true` (what every `typecheck:*` uses)    | type error    | 2    | TS2322   |
 *   | `noEmit: true`                                    | empty include | 2    | TS18003  |
 *   | `noEmitOnError: true` + `outDir`, no `noEmit`     | type error    | 1    | TS2322   |
 *
 * Since every real `typecheck:*` script passes `--noEmit`, the exit code
 * CANNOT separate "detected an error" from "checked nothing" — both are 2.
 * The `noEmitOnError`+`outDir` shape this file's first version used to force
 * a 1 tests a compiler configuration this repo never runs; it satisfied the
 * AC's old sentence while abandoning the property the AC exists to prove.
 * The governing spec's D6/AC-OX-3 has been re-baselined to the discriminator
 * that actually survives under `--noEmit`: the **error code in the output**
 * (`TS2322`/`TS1136` = a real detection, `TS18003` = nothing was ever
 * checked), never the exit code (both probes below now assert exit
 * EXACTLY 2, and are told apart only by which error code appears).
 *
 * Six-dimension coverage:
 *   HAPPY:      `.scratch/probe.ts` is reported ignored by `git check-ignore`;
 *               all seven enumerated typecheck projects' tsconfigs exist and
 *               their `include` globs do not match `.scratch/probe.ts`.
 *   NEGATIVE:   a real TRACKED path (`package.json`) is NOT reported
 *               ignored — proves the ignore assertion isn't vacuously true
 *               because `git check-ignore` itself is broken/misconfigured.
 *   BOUNDARY:   the isolated broken-file probe and the isolated
 *               empty-include probe both exit EXACTLY 2 — proving the
 *               discrimination is NOT available from the exit code — and
 *               are separated only by which error code is present: a real
 *               compile code (`TS2322`/`TS1136`) for the former, `TS18003`
 *               for the latter, each exclusively (the broken-file probe's
 *               output must NOT contain `TS18003`; the empty-include
 *               probe's output must NOT contain a real compile code).
 *   ERROR:      with `noEmit: true`, the broken-file probe must never emit
 *               a sibling `.js` file alongside `broken.ts` even though it
 *               was "checked" (as opposed to the empty-include probe, which
 *               never got far enough to consider emitting anything).
 *   STATE:      every isolated project lives under a fresh `mkdtempSync`
 *               directory, cleaned up in a `finally` per case — no case can
 *               leak into or be perturbed by another.
 *   REGRESSION: a CONTROL case proves the include-glob matcher used for (a)
 *               is not vacuously false — the SAME matcher, given a REAL file
 *               inside a REAL project's `include` glob
 *               (`packages/core/src/index.ts` against `typecheck:core`),
 *               reports a match. Without this, "matches no glob" could
 *               trivially "pass" because the matcher never matches anything.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const ROOT_PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");
const TSC_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsc");

/** Shape this suite reads from root `package.json` -- only the two fields it needs. */
interface RootPackageJson {
  readonly workspaces?: readonly string[];
  readonly scripts?: Readonly<Record<string, string>>;
}

function readRootPackageJson(): RootPackageJson {
  // Read fresh every call -- no module-level cache -- so this always reflects
  // the file actually on disk, matching this repo's established convention
  // (see typecheck-chain-contract.test.ts's readRootPackageJson).
  return JSON.parse(readFileSync(ROOT_PACKAGE_JSON_PATH, "utf8")) as RootPackageJson;
}

/** Extracts a `tsc ... -p <path>` project-file flag's value from a script string, if present. */
function extractDashPFlag(scriptValue: string): string | undefined {
  return scriptValue.match(/-p\s+(\S+)/)?.[1];
}

/** Extracts a bun `--filter '<name>'` (or double-quoted) workspace-package selector, if present. */
function extractFilterPackageName(scriptValue: string): string | undefined {
  return scriptValue.match(/--filter\s+['"]([^'"]+)['"]/)?.[1];
}

/**
 * Resolves a workspace package's directory by its `package.json` `name`
 * field, walking every glob in root `workspaces` (this repo only ever uses
 * the single `"packages/*"` glob, but this walks whatever is declared rather
 * than assuming that one literal string).
 *
 * @throws {Error} if no package under any workspace glob declares `name === pkgName`.
 */
function findWorkspacePackageDir(pkgName: string, workspaceGlobs: readonly string[]): string {
  for (const glob of workspaceGlobs) {
    const baseDir = glob.replace(/\*+$/, "");
    const packagesRoot = join(REPO_ROOT, baseDir);
    let entries: string[];
    try {
      entries = readdirSync(packagesRoot);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidatePkgJsonPath = join(packagesRoot, entry, "package.json");
      if (!existsSync(candidatePkgJsonPath)) continue;
      const candidate = JSON.parse(readFileSync(candidatePkgJsonPath, "utf8")) as { name?: string };
      if (candidate.name === pkgName) return join(packagesRoot, entry);
    }
  }
  throw new Error(`cannot resolve workspace package directory for "${pkgName}" under workspace glob(s) ${workspaceGlobs.join(", ")}`);
}

/**
 * Resolves the absolute tsconfig path a root `typecheck:*` script actually
 * drives, given the script's raw command string and the cwd it runs from.
 * Recursive: a script with no `-p` flag but a bun `--filter '<pkg>'`
 * selector delegates to that workspace package's OWN `typecheck` script
 * (this repo's `typecheck:dashboard` -> `@lore/dashboard`'s `"typecheck"`
 * script, which itself has no `-p` and falls through to the bare-tsc
 * default below).
 *
 * @param scriptValue raw script string from a `package.json` `scripts` map.
 * @param cwd directory the script conceptually runs from (repo root for a
 *   root-level script; the resolved package dir for a delegated one).
 * @param workspaceGlobs root `package.json`'s `workspaces` array, threaded
 *   through for the delegation case.
 */
function resolveTsconfigPathForScript(scriptValue: string, cwd: string, workspaceGlobs: readonly string[]): string {
  const dashP = extractDashPFlag(scriptValue);
  if (dashP !== undefined) return join(cwd, dashP);

  const filterPkg = extractFilterPackageName(scriptValue);
  if (filterPkg !== undefined) {
    const pkgDir = findWorkspacePackageDir(filterPkg, workspaceGlobs);
    const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const delegatedScript = pkgJson.scripts?.typecheck;
    if (delegatedScript === undefined) {
      throw new Error(`workspace package "${filterPkg}" (resolved to ${pkgDir}) declares no "typecheck" script to delegate to`);
    }
    return resolveTsconfigPathForScript(delegatedScript, pkgDir, workspaceGlobs);
  }

  // Bare `tsc --noEmit` with neither `-p` nor a filter delegation: tsc
  // resolves the nearest tsconfig.json in its own cwd.
  return join(cwd, "tsconfig.json");
}

/** One enumerated typecheck project: the root script name that drives it, and the absolute tsconfig path it resolves to. */
interface TypecheckProject {
  readonly scriptName: string;
  readonly tsconfigPath: string;
}

/**
 * Enumerates every `bun run typecheck:*` project from root `package.json`'s
 * OWN `scripts` map -- never a hardcoded list (module header). Excludes the
 * aggregate `"typecheck"` script itself (its key does not start with
 * `"typecheck:"`).
 */
function listTypecheckProjects(): TypecheckProject[] {
  const pkg = readRootPackageJson();
  const scripts = pkg.scripts ?? {};
  const workspaceGlobs = pkg.workspaces ?? [];
  return Object.keys(scripts)
    .filter((name) => name.startsWith("typecheck:"))
    .map((scriptName) => ({
      scriptName,
      tsconfigPath: resolveTsconfigPathForScript(scripts[scriptName] as string, REPO_ROOT, workspaceGlobs),
    }));
}

/**
 * Reads a tsconfig file's OWN declared `include` array (via `ts.readConfigFile`,
 * which strips JSONC comments/trailing commas without resolving `extends`).
 * Every tsconfig this suite enumerates declares `include` itself -- none of
 * them rely on an inherited one -- so not resolving `extends` is correct
 * here, not a shortcut.
 *
 * @throws {Error} if the file cannot be parsed, or declares no `include` array of its own.
 */
function readDeclaredInclude(tsconfigPath: string): readonly string[] {
  const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (error !== undefined) {
    throw new Error(`cannot read tsconfig at ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`);
  }
  const include = (config as { include?: unknown }).include;
  if (!Array.isArray(include)) {
    throw new Error(`tsconfig at ${tsconfigPath} declares no "include" array of its own -- cannot verify .scratch exclusion without one`);
  }
  return include as string[];
}

/**
 * Converts one tsconfig `include` glob segment-by-segment into a `RegExp`
 * anchored on the whole (posix-relative) path. Supports exactly the glob
 * vocabulary this repo's tsconfigs actually use: `**` (zero or more whole
 * path segments) and `*` (any run of non-`/` characters within one
 * segment) -- not a general-purpose glob engine, deliberately, since a
 * static structural check over seven known, simple patterns does not need
 * one.
 */
function globToRegExp(pattern: string): RegExp {
  let source = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*" && pattern[i + 2] === "/") {
      source += "(?:.*/)?";
      i += 3;
      continue;
    }
    if (c === "*" && pattern[i + 1] === "*") {
      source += ".*";
      i += 2;
      continue;
    }
    if (c === "*") {
      source += "[^/]*";
      i += 1;
      continue;
    }
    if (c === "?") {
      source += "[^/]";
      i += 1;
      continue;
    }
    source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  source += "$";
  return new RegExp(source);
}

/**
 * True iff `targetAbsPath` falls inside ANY of `tsconfigPath`'s own declared
 * `include` globs, resolved relative to the tsconfig's own directory (per
 * tsconfig semantics -- `include` globs are always relative to the file that
 * declares them).
 */
function tsconfigIncludeMatches(tsconfigPath: string, targetAbsPath: string): boolean {
  const tsconfigDir = dirname(tsconfigPath);
  const relPath = relative(tsconfigDir, targetAbsPath).split(sep).join("/");
  return readDeclaredInclude(tsconfigPath).some((pattern) => globToRegExp(pattern).test(relPath));
}

/**
 * Compiler options shared by both isolated tsc probes below -- deliberately
 * the SAME `noEmit: true` shape every real `bun run typecheck:*` script
 * actually uses (see the module header's second-order correction). Neither
 * `noEmitOnError` nor `outDir` appears here: that combination is what the
 * FIRST version of this file used to manufacture an exit 1 the real repo
 * never produces.
 */
const ISOLATED_PROBE_COMPILER_OPTIONS = {
  target: "ESNext",
  module: "ESNext",
  moduleResolution: "bundler",
  strict: true,
  skipLibCheck: true,
  noEmit: true,
} as const;

/** A real, DETECTED compile error's code -- as opposed to `TS18003`, a config-level fatal meaning nothing was ever checked. Matches either code this repo's own D6 text names (`TS2322` a type error, `TS1136` a syntax error). */
const REAL_COMPILE_ERROR_CODE_RE = /\bTS(?:2322|1136)\b/;

/** One isolated-project probe's result: the subprocess exit status plus its combined stdout+stderr text. */
interface ProbeResult {
  readonly status: number | null;
  readonly output: string;
  readonly projectDir: string;
}

/**
 * Runs `tsc -p <tsconfigPath>` against a caller-prepared, fully isolated
 * `mkdtemp` project directory and returns its exit status plus combined
 * output. Never touches any file inside this checkout's own tsconfig
 * `include` globs -- `projectDir` is always a fresh OS temp directory,
 * entirely outside REPO_ROOT.
 */
function runIsolatedTscProbe(projectDir: string): ProbeResult {
  const result = spawnSync(TSC_BIN, ["-p", join(projectDir, "tsconfig.json")], {
    cwd: projectDir,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    projectDir,
  };
}

describe("D4 -- .scratch/ probe namespace is gitignored and outside every typecheck project (AC-OX-3)", () => {
  it("HAPPY + NEGATIVE: git check-ignore reports .scratch/probe.ts as ignored, and a real tracked path as NOT ignored", () => {
    const ignored = spawnSync("git", ["check-ignore", "-q", ".scratch/probe.ts"], { cwd: REPO_ROOT });
    expect(ignored.status).toBe(0);

    // NEGATIVE control: a real, git-tracked file must NOT be reported
    // ignored -- proves the assertion above is a real decision, not a
    // check-ignore invocation that is broken/misconfigured and always exits 0.
    const notIgnored = spawnSync("git", ["check-ignore", "-q", "package.json"], { cwd: REPO_ROOT });
    expect(notIgnored.status).toBe(1);
  });

  it("HAPPY: .scratch matches no include glob across all seven bun run typecheck:* projects, enumerated (not hardcoded) from root package.json", () => {
    const projects = listTypecheckProjects();
    expect(projects.map((p) => p.scriptName).sort()).toEqual(
      ["typecheck:core", "typecheck:dashboard", "typecheck:dashboard-e2e", "typecheck:dashboard-tests", "typecheck:lore", "typecheck:lore-tests", "typecheck:scripts"].sort(),
    );
    expect(projects).toHaveLength(7);

    const scratchTarget = join(REPO_ROOT, ".scratch", "probe.ts");
    for (const project of projects) {
      expect(existsSync(project.tsconfigPath), `${project.scriptName} -> tsconfig at ${project.tsconfigPath} must exist on disk`).toBe(true);
      expect(
        tsconfigIncludeMatches(project.tsconfigPath, scratchTarget),
        `${project.scriptName}'s tsconfig at ${project.tsconfigPath} must NOT include .scratch/probe.ts`,
      ).toBe(false);
    }
  });

  it("REGRESSION (control): the SAME glob matcher DOES match a real file inside a real project's include glob -- proves the negative results above are not vacuous", () => {
    const projects = listTypecheckProjects();
    const coreProject = projects.find((p) => p.scriptName === "typecheck:core");
    if (coreProject === undefined) {
      throw new Error("typecheck:core was not found among enumerated projects -- cannot run the positive control");
    }
    const realFile = join(REPO_ROOT, "packages", "core", "src", "index.ts");
    expect(existsSync(realFile), `expected ${realFile} to exist as this suite's positive-control fixture`).toBe(true);
    expect(tsconfigIncludeMatches(coreProject.tsconfigPath, realFile)).toBe(true);

    // And the matcher itself must be sensitive to path, not just filename --
    // the identically-named file one level ABOVE src/ is not included.
    const outsideSrc = join(REPO_ROOT, "packages", "core", "index.ts");
    expect(tsconfigIncludeMatches(coreProject.tsconfigPath, outsideSrc)).toBe(false);
  });
});

describe("D4/D6 -- isolated-project detection-vs-fatal discrimination (AC-OX-3), never inside a real typechecked glob", () => {
  it("BOUNDARY + ERROR: a genuine TS2322 in an isolated project drives tsc to exit EXACTLY 2 (same as the fatal case), naming the broken file with a REAL compile code and never emitting a sibling .js", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "scratch-namespace-probe-broken-"));
    try {
      mkdirSync(join(projectDir, "src"));
      writeFileSync(
        join(projectDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: ISOLATED_PROBE_COMPILER_OPTIONS, include: ["src/**/*"] }),
      );
      writeFileSync(join(projectDir, "src", "broken.ts"), `const x: number = "not a number";\n`);

      const probe = runIsolatedTscProbe(projectDir);

      // Exit code alone cannot discriminate under --noEmit (module header,
      // second-order correction) -- both this case and the empty-include
      // case below exit exactly 2.
      expect(probe.status).toBe(2);
      expect(probe.output).toContain("broken.ts");
      // The discriminator: a REAL compile code is present...
      expect(probe.output).toMatch(REAL_COMPILE_ERROR_CODE_RE);
      // ...and the config-fatal code is ABSENT -- this genuinely was a
      // detection, not a fatal that happened to also print an unrelated TS18003.
      expect(probe.output).not.toContain("TS18003");
      // ERROR dimension: noEmit must have genuinely suppressed any emit --
      // no sibling .js alongside the checked (and erroring) source file.
      expect(existsSync(join(projectDir, "src", "broken.js"))).toBe(false);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("BOUNDARY: an empty include in an isolated project ALSO exits EXACTLY 2, but with TS18003 and no real compile code -- nothing was ever checked", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "scratch-namespace-probe-empty-include-"));
    try {
      writeFileSync(
        join(projectDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: ISOLATED_PROBE_COMPILER_OPTIONS, include: [] }),
      );

      const probe = runIsolatedTscProbe(projectDir);

      expect(probe.status).toBe(2);
      expect(probe.output).toContain("TS18003");
      // The discriminator's other half: no real compile code appears --
      // this is a config fatal, not a detection that happens to exit 2.
      expect(probe.output).not.toMatch(REAL_COMPILE_ERROR_CODE_RE);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("REGRESSION (control): the SAME status===2 is NOT by itself proof of detection -- the two cases above are told apart only by the error code, which this case cross-checks explicitly", () => {
    const brokenDir = mkdtempSync(join(tmpdir(), "scratch-namespace-probe-cross-broken-"));
    const emptyDir = mkdtempSync(join(tmpdir(), "scratch-namespace-probe-cross-empty-"));
    try {
      mkdirSync(join(brokenDir, "src"));
      writeFileSync(join(brokenDir, "tsconfig.json"), JSON.stringify({ compilerOptions: ISOLATED_PROBE_COMPILER_OPTIONS, include: ["src/**/*"] }));
      writeFileSync(join(brokenDir, "src", "broken.ts"), `const x: number = "not a number";\n`);
      writeFileSync(join(emptyDir, "tsconfig.json"), JSON.stringify({ compilerOptions: ISOLATED_PROBE_COMPILER_OPTIONS, include: [] }));

      const brokenProbe = runIsolatedTscProbe(brokenDir);
      const emptyProbe = runIsolatedTscProbe(emptyDir);

      // Same exit code -- the whole point of the correction.
      expect(brokenProbe.status).toBe(emptyProbe.status);
      // Yet distinguishable by error code alone.
      expect(REAL_COMPILE_ERROR_CODE_RE.test(brokenProbe.output)).toBe(true);
      expect(REAL_COMPILE_ERROR_CODE_RE.test(emptyProbe.output)).toBe(false);
      expect(brokenProbe.output.includes("TS18003")).toBe(false);
      expect(emptyProbe.output.includes("TS18003")).toBe(true);
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
