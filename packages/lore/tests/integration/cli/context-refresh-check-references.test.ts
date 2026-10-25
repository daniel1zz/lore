// @spawns packages/lore/src/index.ts
/**
 * `lore context refresh --check` (the `check:memory-files` oracle) checks code references, not
 * only structure and capacity (spec-prose-about-code-is-bound-to-what-it-describes-one D1; the
 * wiring half of AC-BIND-1: a resolver that a caller can leave unwired is not a capability).
 *
 * Spawns the real CLI against mkdtemp projects; never the repo's own CLAUDE.md.
 *
 * Coverage: HAPPY (a bad `path#Symbol` in CLAUDE.md exits non-zero naming reference_unresolved
 * and the line) / NEGATIVE (a good reference never names it as a finding) / BOUNDARY (a bad reference in a context fragment is named
 * with its fragment path) / STATE (refresh --check writes nothing).
 *
 * @spec_ref spec-prose-about-code-is-bound-to-what-it-describes-one
 * @ac_ref AC-BIND-1
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function put(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-refresh-check-refs-"));
  scratch.push(dir);
  const git = spawnSync("git", ["init", "-q", dir]);
  if (git.status !== 0) throw new Error(`git init failed: ${String(git.stderr)}`);
  const init = spawnSync("bun", ["run", INDEX_TS, "init"], {
    cwd: dir,
    env: { ...process.env, HOME: dir, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  if (init.status !== 0) throw new Error(`lore init failed: ${String(init.stderr)}`);
  put(dir, "src/x.ts", "export const Here = 1;\n");
  return dir;
}

function refreshCheck(dir: string): { exitCode: number; output: string } {
  const result = spawnSync("bun", ["run", INDEX_TS, "context", "refresh", "--check"], {
    cwd: dir,
    env: { ...process.env, HOME: dir, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return { exitCode: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("context refresh --check resolves code references", () => {
  it("HAPPY: a path#Symbol the file does not export fails the check, naming reference_unresolved, the reference and its line", () => {
    const dir = project();
    put(dir, "CLAUDE.md", "# Proj\n\nSee `src/x.ts#Gone` for the mechanism.\n");

    const { exitCode, output } = refreshCheck(dir);

    expect(exitCode).not.toBe(0);
    expect(output).toContain("reference_unresolved");
    expect(output).toContain("src/x.ts#Gone");
    expect(output).toContain("CLAUDE.md:3");
  });

  it("NEGATIVE: the same text with an exported symbol never names reference_unresolved", () => {
    const dir = project();
    put(dir, "CLAUDE.md", "# Proj\n\nSee `src/x.ts#Here` for the mechanism.\n");

    expect(refreshCheck(dir).output).not.toContain("reference_unresolved");
  });

  it("BOUNDARY: a bad script reference in a context fragment is named with the fragment's path", () => {
    const dir = project();
    put(dir, "package.json", JSON.stringify({ name: "fixture", scripts: { build: "tsc" } }));
    put(dir, "CLAUDE.md", "# Proj\n");
    put(
      dir,
      ".lore/context/frag.md",
      ["---", "id: project-frag", "title: Frag", "inject: [subagent-start]", "---", "Run `bun run no-such-script`.", ""].join("\n"),
    );

    const { exitCode, output } = refreshCheck(dir);

    expect(exitCode).not.toBe(0);
    expect(output).toContain(".lore/context/frag.md:6");
    expect(output).toContain("script_missing");
  });

  it("STATE: --check writes nothing", () => {
    const dir = project();
    const body = "# Proj\n\nSee `src/x.ts#Gone`.\n";
    put(dir, "CLAUDE.md", body);

    refreshCheck(dir);

    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(body);
  });
});
