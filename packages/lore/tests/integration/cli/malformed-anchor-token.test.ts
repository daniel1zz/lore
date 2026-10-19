// @spawns packages/lore/src/index.ts
/**
 * One anchor grammar, two meanings of "invalid" (spec-prose-about-code-is-bound-to-what-it-describes-one D1):
 * the anchor WRITE path (`lore anchor add`) refuses a malformed `path#symbol` with its existing
 * VALIDATION_ERROR (exit 4, same message); PROSE extraction treats the same token in a CLAUDE.md as
 * "not a reference": `refresh --check` and `status --check-claude-md` neither error nor report it.
 *
 * Fixture token: `foo/bar.ts#not-an-id` where `foo/bar.ts` does NOT exist, so a reader that fell
 * back to "path only" would report file_missing; the right answer is silence.
 *
 * Coverage: HAPPY (a well-formed reference to a missing file IS reported: the control) / NEGATIVE
 * (malformed token: no error, no report, in both checks) / ERROR (`anchor add` refuses, exit 4, exact
 * message) / BOUNDARY (folder + symbol is the same grammar's other invalid form) / REGRESSION (a
 * valid `anchor add` still succeeds).
 *
 * @spec_ref spec-prose-about-code-is-bound-to-what-it-describes-one
 * @ac_ref AC-BIND-1
 */

import { afterAll, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

function runLore(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

const dir = mkdtempSync(join(tmpdir(), "lore-malformed-anchor-"));
spawnSync("git", ["init", "-q", dir]);
const init = runLore(["init"], dir);
if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
appendFileSync(
  join(dir, ".lore", "config.yaml"),
  ["workflow:", "  gates:", "    spec-create:", "      enabled: false", "context:", "  memory_files:", "    adoption: enforce", ""].join("\n"),
);
const spec = runLore(["create", "spec", "--title", "Anchor Grammar Fixture", "--no-ai", "--content", "## Goal\n\nBody.", "--json"], dir);
if (spec.exitCode !== 0) throw new Error(`create spec failed: ${spec.stderr}${spec.stdout}`);
const specSlug = (JSON.parse(spec.stdout) as { data: { slug: string } }).data.slug;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const MALFORMED = "foo/bar.ts#not-an-id";

function writeClaudeMd(line: string): void {
  writeFileSync(join(dir, "CLAUDE.md"), `# Proj\n\n${line}\n`);
}

describe("malformed path#symbol: refused by anchor writes, not-a-reference in prose", () => {
  it("HAPPY (control): a well-formed reference to a missing file is reported by both checks", () => {
    writeClaudeMd("See `foo/bar.ts#Gone`.");

    const refresh = runLore(["context", "refresh", "--check"], dir);
    const status = runLore(["status", "--check-claude-md"], dir);

    expect(refresh.stdout + refresh.stderr).toContain("reference_unresolved");
    expect(status.stdout + status.stderr).toContain("reference_unresolved");
  }, 120_000);

  it("NEGATIVE: the malformed token neither errors nor is reported, in refresh --check and in status --check-claude-md", () => {
    writeClaudeMd(`See \`${MALFORMED}\`.`);

    const refresh = runLore(["context", "refresh", "--check"], dir);
    const status = runLore(["status", "--check-claude-md"], dir);

    for (const run of [refresh, status]) {
      const output = run.stdout + run.stderr;
      expect(output).not.toContain("reference_unresolved");
      expect(output).not.toContain(MALFORMED);
      expect(output).not.toMatch(/VALIDATION_ERROR|invalid code anchor|code anchor symbol must be/);
    }
  }, 120_000);

  it("ERROR: `lore anchor add` still refuses the same token, exit 4, with the unchanged message", () => {
    const result = runLore(["anchor", "add", specSlug, MALFORMED], dir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(
      `code anchor symbol must be an ASCII identifier matching /^[A-Za-z_$][A-Za-z0-9_$]*$/ (or a quoted "test title" on a test file): "${MALFORMED}"`,
    );
  }, 60_000);

  it("BOUNDARY: a folder anchor carrying a symbol is refused by anchor add (same grammar, other invalid form)", () => {
    const refused = runLore(["anchor", "add", specSlug, "foo/#Sym"], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain('directory anchor must not carry a #Symbol: "foo/#Sym"');
  }, 60_000);

  it("REGRESSION: a valid anchor add still succeeds", () => {
    expect(runLore(["anchor", "add", specSlug, "foo/bar.ts#Valid"], dir).exitCode).toBe(0);
  }, 60_000);
});
