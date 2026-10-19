#!/usr/bin/env bun
/**
 * `bun run check:no-bunx-of-declared-deps` — refuses a package.json script
 * (root or any workspace package) that runs `bunx <pkg>`, `bun x <pkg>` or
 * `npx <pkg>` where `<pkg>` is a declared dependency/devDependency of that
 * package or of the root.
 *
 * Why: bunx resolves through one machine-wide temp cache shared by every
 * session. Concurrent floors/typechecks race on installs into it and leave it
 * broken, so a build result depends on another session's timing. A declared
 * dependency is already installed by `bun install --frozen-lockfile`; run its
 * bin directly (`tsr generate`, `bun --bun vitest`).
 *
 * Public surface: `findBunxOfDeclaredDeps` (pure), `main` (IO).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface PackageManifest {
  /** Repo-relative path of the package.json (used in messages). */
  readonly file: string;
  readonly name: string;
  readonly scripts: Readonly<Record<string, string>>;
  readonly declared: readonly string[];
}

export interface BunxViolation {
  readonly file: string;
  readonly packageName: string;
  readonly script: string;
  readonly dependency: string;
}

const QUOTED = /'[^']*'|"[^"]*"/g;
const LAUNCHER = /^(?:bunx|npx|bun\s+x)\s+(.*)$/;

/** Package name a launcher segment fetches, or null when the segment is not a launcher call. */
function launchedPackage(segment: string): string | null {
  const match = LAUNCHER.exec(segment.trim());
  if (match === null) return null;
  const first = match[1]!.split(/\s+/).find((token) => token !== "" && !token.startsWith("-"));
  if (first === undefined) return null;
  // Strip a version suffix (`pkg@latest`, `@scope/pkg@1.2.3`) but keep a leading scope `@`.
  const at = first.indexOf("@", 1);
  return at === -1 ? first : first.slice(0, at);
}

export function findBunxOfDeclaredDeps(
  manifests: readonly PackageManifest[],
  rootDeclared: readonly string[],
): BunxViolation[] {
  const violations: BunxViolation[] = [];
  for (const manifest of manifests) {
    const declared = new Set([...manifest.declared, ...rootDeclared]);
    for (const [script, command] of Object.entries(manifest.scripts)) {
      // Quoted text is prose (echo messages), never a command position.
      const bare = command.replace(QUOTED, "''");
      for (const segment of bare.split(/&&|\|\||;|\|/)) {
        const pkg = launchedPackage(segment);
        if (pkg !== null && declared.has(pkg)) {
          violations.push({ file: manifest.file, packageName: manifest.name, script, dependency: pkg });
        }
      }
    }
  }
  return violations;
}

function readManifest(repoRoot: string, relative: string): PackageManifest {
  const raw = JSON.parse(readFileSync(join(repoRoot, relative), "utf8")) as Record<string, unknown>;
  const keys = (field: string): string[] => Object.keys((raw[field] as Record<string, string> | undefined) ?? {});
  return {
    file: relative,
    name: typeof raw.name === "string" ? raw.name : relative,
    scripts: (raw.scripts as Record<string, string> | undefined) ?? {},
    declared: [...keys("dependencies"), ...keys("devDependencies"), ...keys("optionalDependencies")],
  };
}

export function loadManifests(repoRoot: string): PackageManifest[] {
  const manifests = [readManifest(repoRoot, "package.json")];
  const packagesDir = join(repoRoot, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    const relative = `packages/${entry.name}/package.json`;
    if (entry.isDirectory() && existsSync(join(repoRoot, relative))) manifests.push(readManifest(repoRoot, relative));
  }
  return manifests;
}

/** @returns process exit code (0 clean / 1 violations). */
export function main(repoRoot: string = REPO_ROOT): number {
  const manifests = loadManifests(repoRoot);
  const violations = findBunxOfDeclaredDeps(manifests, manifests[0]!.declared);
  if (violations.length === 0) {
    console.log("check:no-bunx-of-declared-deps: PASS (no script launches a declared dependency through bunx/npx)");
    return 0;
  }
  for (const v of violations) {
    console.error(
      `${v.file} (${v.packageName}) script "${v.script}" runs a launcher on declared dependency ${v.dependency}; run its installed bin instead`,
    );
  }
  console.error(`check:no-bunx-of-declared-deps: FAIL (${violations.length} violation(s))`);
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
