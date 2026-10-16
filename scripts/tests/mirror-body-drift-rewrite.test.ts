/**
 * AC-CRIT-4 / AC-CRIT-5 — spec-close-the-eight-verified-critical-defects-no-judge-listing §Design F3.
 *
 * The mirror directories are a PROJECTION of the corpus: `bun run mirror:export` (no flags) must
 * rewrite a changed body (spec AND knowledge), after which `--check` exits 0; `lore export-docs`
 * without --force keeps SPEC-021 Amendment A2 (a changed body is left untouched). A status-only
 * drift must make `--check` exit exactly 2 and name the file.
 *
 * Drives the real `main()` of scripts/export-spec-mirror.ts through a `bun run` driver subprocess
 * against a throwaway corpus (mkdtemp + `lore init`), never this repo's own `.lore/`.
 *
 * Coverage: HAPPY (body rewrite, convergence) / NEGATIVE (export-docs without force untouched) /
 * STATE (status-only drift detected by --check, then repaired).
 *
 * @spec_ref spec-close-the-eight-verified-critical-defects-no-judge-listing AC-CRIT-4 AC-CRIT-5
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMirrorMappings } from "../export-spec-mirror-core.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const MIRROR_SCRIPT_JS_SPECIFIER = join(REPO_ROOT, "scripts", "export-spec-mirror.js");

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

function lore(cwd: string, args: readonly string[]): string {
  return execFileSync("bun", [LORE_ENTRY, ...args], { cwd, stdio: "pipe" }).toString();
}

function createdId(out: string): string {
  const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as { ok: boolean; data?: { id: string } };
  if (!parsed.ok || parsed.data === undefined) throw new Error(`lore create failed: ${out}`);
  return parsed.data.id;
}

/** A body that satisfies the spec-create gate's required skeleton (Overview/Goal, Scope, Acceptance Criteria). */
function specBody(marker: string): string {
  return `# Body Rewrite Spec\n\n## Overview\n\n${marker}\n\n## Scope\n\nMirror only.\n\n## Acceptance Criteria\n\nNone yet.\n`;
}

function writeDriver(dir: string): string {
  const driverPath = join(dir, "mirror-body-driver.ts");
  writeFileSync(
    driverPath,
    `import { main } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)};
const [, , mode, dbPath, repoRoot] = process.argv;
const exitCode = await main(mode === "check" ? ["--check"] : [], repoRoot, dbPath);
process.exit(exitCode);
`,
    "utf8",
  );
  return driverPath;
}

function runDriver(driverPath: string, mode: "export" | "check", dbPath: string, root: string) {
  const r = spawnSync("bun", ["run", driverPath, mode, dbPath, root], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.status === null) throw new Error(`driver crashed: ${r.stderr}`);
  return { exitCode: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

interface Fixture {
  readonly dir: string;
  readonly dbPath: string;
  readonly driver: string;
  readonly specId: string;
  readonly knowledgeId: string;
}

function seed(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "lore-mirror-body-"));
  tmpDirs.push(dir);
  lore(dir, ["init", "--author", "mirror-body-test"]);
  const specId = createdId(
    lore(dir, ["create", "spec", "--title", "Body Rewrite Spec", "--content", specBody("Original spec body."), "--json"]),
  );
  const knowledgeId = createdId(
    lore(dir, [
      "create", "knowledge", "--title", "Body Rewrite Knowledge", "--sub-type", "reference",
      "--content", "# Body Rewrite Knowledge\n\nOriginal knowledge body.\n", "--json",
    ]),
  );
  const dbPath = join(dir, ".lore", "lore.db");
  const driver = writeDriver(dir);
  expect(runDriver(driver, "export", dbPath, dir).exitCode).toBe(0);
  return { dir, dbPath, driver, specId, knowledgeId };
}

function mirrorFile(fx: Fixture, id: string): string {
  const mapping = loadMirrorMappings(fx.dir)[id];
  if (mapping === undefined) throw new Error(`no export-index mapping for ${id}`);
  return join(fx.dir, mapping.file_path);
}

describe("AC-CRIT-4 — body change: mirror export rewrites changed bodies, export-docs without --force does not", () => {
  it(
    "body change: spec + knowledge bodies changed, `mirror:export` (no flags) rewrites both and --check exits 0",
    () => {
      const fx = seed();
      lore(fx.dir, ["set", fx.specId, "--content", specBody("Changed spec body.")]);
      lore(fx.dir, ["set", fx.knowledgeId, "--content", "# Body Rewrite Knowledge\n\nChanged knowledge body.\n"]);

      const exp = runDriver(fx.driver, "export", fx.dbPath, fx.dir);
      expect(exp.exitCode).toBe(0);
      expect(readFileSync(mirrorFile(fx, fx.specId), "utf8")).toContain("Changed spec body.");
      expect(readFileSync(mirrorFile(fx, fx.knowledgeId), "utf8")).toContain("Changed knowledge body.");

      const check = runDriver(fx.driver, "check", fx.dbPath, fx.dir);
      expect(check.exitCode).toBe(0);
    },
    120_000,
  );

  it(
    "body change: `lore export-docs` without --force leaves a changed body untouched (SPEC-021 A2)",
    () => {
      const fx = seed();
      const file = mirrorFile(fx, fx.knowledgeId);
      lore(fx.dir, ["set", fx.knowledgeId, "--content", "# Body Rewrite Knowledge\n\nChanged knowledge body.\n"]);
      const before = readFileSync(file, "utf8");
      lore(fx.dir, ["export-docs"]);
      const after = readFileSync(file, "utf8");
      expect(after).toBe(before);
      expect(after).toContain("Original knowledge body.");
    },
    120_000,
  );
});

describe("AC-CRIT-5 — status-only drift is counted by --check", () => {
  it(
    "status-only: --check exits exactly 2 naming the file, and mirror:export then converges to exit 0",
    () => {
      const fx = seed();
      lore(fx.dir, ["set", fx.knowledgeId, "--status", "archived"]);
      const file = mirrorFile(fx, fx.knowledgeId);

      const check = runDriver(fx.driver, "check", fx.dbPath, fx.dir);
      expect(check.exitCode).toBe(2);
      const relPath = loadMirrorMappings(fx.dir)[fx.knowledgeId]!.file_path;
      expect(check.stdout + check.stderr).toContain(relPath);
      // --check stays read-only
      expect(readFileSync(file, "utf8")).toMatch(/^status: draft$/m);

      expect(runDriver(fx.driver, "export", fx.dbPath, fx.dir).exitCode).toBe(0);
      expect(readFileSync(file, "utf8")).toMatch(/^status: archived$/m);
      expect(runDriver(fx.driver, "check", fx.dbPath, fx.dir).exitCode).toBe(0);
    },
    120_000,
  );
});
