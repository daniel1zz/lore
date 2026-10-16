/**
 * task-skill-implement-r0-6-mirror-detects-and-repairs-duplicate — AC-R0-5
 * (spec-round-0-main-is-green-every-red-test-on-e1878626-traced-to; reports #210, #234, #32).
 *
 * Measured on main @ e1878626: ten pairs of live spec docs (SPEC-092, 095-102, 156) shared one
 * `human_id` in `.lore/export-index.json` under DIFFERENT file_paths. `repairCollisions` only
 * grouped by file_path, and `mirror --check` only compares counts / slugs / bodies, so neither
 * noticed. This test drives the real `main()` (same path as `bun run check:spec-mirror` /
 * `mirror:export`) against a THROWAWAY corpus (mkdtemp + `lore init`, never this repo's `.lore/`).
 *
 * @spec_ref spec-round-0-main-is-green-every-red-test-on-e1878626-traced-to AC-R0-5
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MIRROR_DRIFT_EXIT_CODE } from "../export-spec-mirror-core.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const MIRROR_SCRIPT_JS_SPECIFIER = join(REPO_ROOT, "scripts", "export-spec-mirror.js");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeDriver(dir: string): string {
  const driverPath = join(dir, "mirror-collision-driver.ts");
  writeFileSync(
    driverPath,
    `import { main } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)};
const [, , dbPath, repoRoot, ...argv] = process.argv;
process.exit(await main(argv, repoRoot, dbPath));
`,
    "utf8",
  );
  return driverPath;
}

function runMirror(driver: string, dir: string, args: string[]): { exitCode: number; out: string } {
  const r = spawnSync("bun", ["run", driver, join(dir, ".lore", "lore.db"), dir, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.status === null) throw new Error(`driver crashed (signal ${r.signal}): ${r.stderr}`);
  return { exitCode: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

function createKnowledge(dir: string, title: string): string {
  const out = execFileSync(
    "bun",
    [LORE_ENTRY, "create", "knowledge", "--title", title, "--sub-type", "reference", "--content", `# ${title}\n\nBody ${title}.\n`, "--json"],
    { cwd: dir, stdio: "pipe" },
  ).toString();
  const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as { ok: boolean; data: { id: string; slug: string } };
  if (!parsed.ok) throw new Error(out);
  return parsed.data.id;
}

interface Mapping { human_id: string; file_path: string }
function readMappings(dir: string): Record<string, Mapping> {
  return (JSON.parse(readFileSync(join(dir, ".lore", "export-index.json"), "utf8")) as { mappings: Record<string, Mapping> }).mappings;
}

describe("AC-R0-5 — two live docs mapped to one human_id", () => {
  it(
    "--check exits exactly 2 naming both docs and the human_id; the exporter's repair leaves no duplicates and --check exits 0",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "lore-mirror-dup-"));
      tmpDirs.push(dir);
      execFileSync("bun", [LORE_ENTRY, "init", "--author", "mirror-dup-test"], { cwd: dir, stdio: "pipe" });
      const idA = createKnowledge(dir, "Duplicate Alpha");
      const idB = createKnowledge(dir, "Duplicate Beta");
      const driver = writeDriver(dir);

      // Converge first: a clean corpus must pass --check (negative control for the later red).
      expect(runMirror(driver, dir, []).exitCode).toBe(0);
      expect(runMirror(driver, dir, ["--check"]).exitCode).toBe(0);

      // Corrupt: B claims A's human_id under B's own (distinct) file_path — the measured shape.
      const indexPath = join(dir, ".lore", "export-index.json");
      const index = JSON.parse(readFileSync(indexPath, "utf8")) as { mappings: Record<string, Mapping> };
      const sharedHumanId = index.mappings[idA]!.human_id;
      const oldBPath = index.mappings[idB]!.file_path;
      const oldBHumanId = index.mappings[idB]!.human_id;
      index.mappings[idB]!.human_id = sharedHumanId;
      // Keep B's mirror file self-consistent (frontmatter id: = the shared id) so the ONLY defect
      // left is the duplicate human_id — exactly the measured on-disk shape.
      const bAbs = join(dir, oldBPath);
      writeFileSync(bAbs, readFileSync(bAbs, "utf8").replace(`id: ${oldBHumanId}`, `id: ${sharedHumanId}`), "utf8");
      writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");

      const red = runMirror(driver, dir, ["--check"]);
      expect(red.exitCode).toBe(MIRROR_DRIFT_EXIT_CODE);
      expect(red.out).toContain(sharedHumanId);
      expect(red.out).toContain(idA);
      expect(red.out).toContain(idB);

      // Repair via the exporter.
      expect(runMirror(driver, dir, []).exitCode).toBe(0);
      const after = readMappings(dir);
      const humanIds = Object.values(after).map((m) => m.human_id);
      expect(new Set(humanIds).size).toBe(humanIds.length);
      expect(after[idA]!.human_id).toBe(sharedHumanId); // earliest doc keeps the id
      expect(after[idB]!.human_id).not.toBe(sharedHumanId);
      expect(existsSync(join(dir, after[idB]!.file_path))).toBe(true);
      expect(after[idB]!.file_path === oldBPath ? true : !existsSync(join(dir, oldBPath))).toBe(true);

      expect(runMirror(driver, dir, ["--check"]).exitCode).toBe(0);
    },
    180_000,
  );
});
