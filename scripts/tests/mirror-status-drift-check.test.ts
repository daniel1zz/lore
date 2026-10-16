/**
 * AC-OX-6 — spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check (fixture half).
 *
 * AC-OX-6 used to be `scripts/tests/mirror-status-parity.test.ts`, a unit test that read THIS
 * repository's live corpus (`lore list` over the real `.lore/`) and the real `docs/requirements/`
 * tree. A test whose verdict depends on live state goes red whenever unrelated corpus work lands,
 * so the real-repo sweep now lives where live state belongs — `bun run check:spec-mirror`, which
 * the AC's command runs first and which `scripts/export-spec-mirror.ts --check` implements through
 * `computeMirrorParity` (both directions: every doc has a mapped file, no mapping is orphaned) and
 * `computeMirrorContentDrift` (`frontmatter_divergent`: a status-only drift is drift, AC-CRIT-5).
 *
 * This file is the other half of the rebound AC: it proves, on a THROWAWAY corpus (`mkdtemp` +
 * `lore init`, never this repo's `.lore/`) that `--check` really catches the exact defect the old
 * sweep existed for — a mirror file whose frontmatter `status` disagrees with its corpus doc while
 * the BODY is byte-unchanged (scripts/export-spec-mirror-core.ts `computeMirrorContentDrift`'s
 * `frontmatterPaths` branch, reached through `report.frontmatter_repaired`/`frontmatter_declined`).
 * Without a fixture proof, `bun run check:spec-mirror` exiting 0 on the real tree could not
 * distinguish "no drift" from "a check blind to frontmatter" — the measured defect (202 of 1470
 * files drifted while every command printed OK).
 *
 * Every drift case is a PAIRED transition on the SAME corpus: break the file, `--check` exits
 * EXACTLY {@link MIRROR_DRIFT_EXIT_CODE} naming the slug; restore the exact bytes, the identical
 * run exits EXACTLY 0. A bare non-zero assertion could not tell a detection from a crash.
 *
 * Why a driver subprocess: `export-spec-mirror.ts` top-level-imports `createApp` -> `bun:sqlite`,
 * unresolvable in a vitest worker, and it derives its repo root from its own on-disk location —
 * only a real `bun run` driver can call `main(argv, repoRoot, dbPath)` with throwaway overrides
 * (same mechanism as `spec-mirror-content-drift.test.ts`).
 *
 * @spec_ref spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check AC-OX-6
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMirrorMappings, MIRROR_DRIFT_EXIT_CODE } from "../export-spec-mirror-core.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
// `.js` specifier — Bun resolves this to the sibling `.ts` source (project CLAUDE.md "Import style").
const MIRROR_SCRIPT_JS_SPECIFIER = join(REPO_ROOT, "scripts", "export-spec-mirror.js");

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup — a leftover temp dir must never fail the run
    }
  }
});

function writeDriver(dir: string): string {
  const driverPath = join(dir, "mirror-status-driver.ts");
  const source = `
import { main } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)};

const [, , mode, dbPath, repoRoot] = process.argv;
const exitCode = await main(mode === "check" ? ["--check"] : [], repoRoot, dbPath);
console.log(JSON.stringify({ exitCode }));
process.exit(exitCode);
`;
  writeFileSync(driverPath, source, "utf8");
  return driverPath;
}

interface DriverResult {
  readonly exitCode: number;
  readonly output: string;
}

function runDriver(driverPath: string, mode: "check" | "export", dbPath: string, repoRoot: string): DriverResult {
  const result = spawnSync("bun", ["run", driverPath, mode, dbPath, repoRoot], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status === null) {
    throw new Error(`mirror-status-driver crashed (signal ${result.signal}): ${result.stderr}`);
  }
  return { exitCode: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

function createKnowledge(dir: string, title: string): { id: string; slug: string } {
  const out = execFileSync(
    "bun",
    [
      LORE_ENTRY, "create", "knowledge",
      "--title", title,
      "--sub-type", "reference",
      "--content", `# ${title}\n\nThe corpus is the only place this body is authored.\n`,
      "--json",
    ],
    { cwd: dir, stdio: "pipe" },
  ).toString();
  const created = JSON.parse(out) as { ok: boolean; data?: { id?: string; slug?: string } };
  if (!created.ok || created.data?.id === undefined || created.data.slug === undefined) {
    throw new Error(`test setup: lore create knowledge did not return an id+slug: ${out}`);
  }
  return { id: created.data.id, slug: created.data.slug };
}

interface Seeded {
  readonly dir: string;
  readonly dbPath: string;
  readonly driverPath: string;
  readonly slug: string;
  readonly absFilePath: string;
  readonly exportedContent: string;
}

/** Throwaway corpus with one exported knowledge doc, baseline `--check` asserted CLEAN first. */
function seedExportedMirror(): Seeded {
  const dir = mkdtempSync(join(tmpdir(), "lore-mirror-status-"));
  tmpDirs.push(dir);
  execFileSync("bun", [LORE_ENTRY, "init", "--author", "mirror-status-test"], { cwd: dir, stdio: "pipe" });
  const { id, slug } = createKnowledge(dir, "Status Drift Probe");
  const dbPath = join(dir, ".lore", "lore.db");
  const driverPath = writeDriver(dir);

  const exported = runDriver(driverPath, "export", dbPath, dir);
  if (exported.exitCode !== 0) throw new Error(`test setup: baseline export exited ${exported.exitCode}: ${exported.output}`);
  const baseline = runDriver(driverPath, "check", dbPath, dir);
  if (baseline.exitCode !== 0) throw new Error(`test setup: baseline check exited ${baseline.exitCode}: ${baseline.output}`);

  const mapping = loadMirrorMappings(dir)[id];
  if (mapping === undefined) throw new Error(`test setup: no export-index mapping for ${id} after the baseline export`);
  const absFilePath = join(dir, mapping.file_path);
  return { dir, dbPath, driverPath, slug, absFilePath, exportedContent: readFileSync(absFilePath, "utf8") };
}

/** Rewrites ONLY the frontmatter `status:` scalar; the body bytes are untouched. */
function withStatus(content: string, status: string): string {
  const next = content.replace(/^status: .*$/m, `status: ${status}`);
  if (next === content) throw new Error(`test setup: no status: line to rewrite in:\n${content}`);
  return next;
}

describe("AC-OX-6 fixture — `--check` catches a status-only frontmatter drift (scripts/export-spec-mirror-core.ts computeMirrorContentDrift)", () => {
  it(
    "HAPPY/RED PAIRED: flipping ONLY the mirror file's frontmatter status (body byte-unchanged) makes --check exit EXACTLY 2 naming the slug; restoring the exact bytes exits EXACTLY 0",
    () => {
      const seeded = seedExportedMirror();
      const corpusStatus = /^status: (.*)$/m.exec(seeded.exportedContent)?.[1]?.trim();
      expect(corpusStatus, "exported mirror must carry a status: line").toBeDefined();
      const drifted = withStatus(seeded.exportedContent, corpusStatus === "archived" ? "draft" : "archived");

      // The body is byte-identical: only the status line differs — the exact shape the old
      // body-only comparison was blind to.
      const stripStatus = (s: string): string => s.replace(/^status: .*$/m, "");
      expect(stripStatus(drifted)).toBe(stripStatus(seeded.exportedContent));

      writeFileSync(seeded.absFilePath, drifted, "utf8");
      const red = runDriver(seeded.driverPath, "check", seeded.dbPath, seeded.dir);
      expect(red.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
      expect(MIRROR_DRIFT_EXIT_CODE).toBe(2);
      expect(red.output).toContain(seeded.slug);

      writeFileSync(seeded.absFilePath, seeded.exportedContent, "utf8");
      const green = runDriver(seeded.driverPath, "check", seeded.dbPath, seeded.dir);
      expect(green.exitCode).toBe(0);
      expect(green.output).not.toContain(seeded.slug + " —");
    },
    120_000,
  );

  it(
    "NEGATIVE: the check does not repair what it inspects — two consecutive --check runs on a status-drifted file report the same exit and the file stays drifted",
    () => {
      const seeded = seedExportedMirror();
      const drifted = withStatus(seeded.exportedContent, /^status: archived$/m.test(seeded.exportedContent) ? "draft" : "archived");
      writeFileSync(seeded.absFilePath, drifted, "utf8");

      const first = runDriver(seeded.driverPath, "check", seeded.dbPath, seeded.dir);
      const second = runDriver(seeded.driverPath, "check", seeded.dbPath, seeded.dir);
      expect(first.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
      expect(second.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
      expect(readFileSync(seeded.absFilePath, "utf8")).toBe(drifted);
    },
    120_000,
  );

  it(
    "BOUNDARY (other direction): a live doc created AFTER the export has no mirror mapping — --check fails naming its slug, and exporting makes the identical run exit 0",
    () => {
      const seeded = seedExportedMirror();
      const late = createKnowledge(seeded.dir, "Never Exported Probe");

      const red = runDriver(seeded.driverPath, "check", seeded.dbPath, seeded.dir);
      expect(red.exitCode).not.toBe(0);
      expect(red.output).toContain(late.slug);

      const exported = runDriver(seeded.driverPath, "export", seeded.dbPath, seeded.dir);
      expect(exported.exitCode).toBe(0);
      const green = runDriver(seeded.driverPath, "check", seeded.dbPath, seeded.dir);
      expect(green.exitCode).toBe(0);
    },
    120_000,
  );
});
