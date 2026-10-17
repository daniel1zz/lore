// @reads .claude/**
// @reads assets/**
/**
 * Distribution carries the no-parent spec contract (AC-BLS3B-9, BR-1, BR-2, AS-18).
 *
 * A spec takes no parent and relates to the trees by citing rules. Everything
 * lore ships (assets/ and the repo's .claude/ rules) must say so: no line may
 * pair `create spec` with `--parent`, and the lore-design skill must teach
 * `lore ac cite`. The manifest parity half of the AC is covered by
 * assets-ssot.test.ts / embed-assets-manifest.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../../..");

function walk(dir: string, out: string[]): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "worktrees") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(md|mdx|txt|json|sh|mjs|ts|yaml|yml)$/.test(name)) out.push(p);
  }
  return out;
}

/** Lines that pair `create spec` with `--parent` (same command; backslash-wrapped continuations included). */
function findOffenders(root: string): string[] {
  const hits: string[] = [];
  for (const file of walk(join(REPO_ROOT, root), [])) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/create spec/.test(line)) return;
      // the command's own text: this line, plus continuation lines while a trailing backslash wraps it
      let command = line;
      for (let j = i; /\\\s*$/.test(lines[j] ?? "") && j < i + 4; j++) command += " " + (lines[j + 1] ?? "");
      // a plan's `--parent <spec>` in a later backticked command on the same line is allowed
      if (/create spec[^`]*--parent\b/.test(command)) {
        hits.push(`${relative(REPO_ROOT, file)}:${i + 1}: ${line.trim().slice(0, 140)}`);
      }
    });
  }
  return hits;
}

describe("distribution carries the no-parent spec contract (AC-BLS3B-9)", () => {
  it("no asset file pairs `create spec` with `--parent`", () => {
    expect(findOffenders("assets"), "offenders (file:line)").toEqual([]);
  });

  it("no shipped .claude/ file pairs `create spec` with `--parent`", () => {
    expect(findOffenders(".claude"), "offenders (file:line)").toEqual([]);
  });

  it("the lore-design skill teaches citing rules with `lore ac cite`", () => {
    const body = readFileSync(join(REPO_ROOT, "assets/skills/lore-design/SKILL.md"), "utf8");
    expect(body).toContain("lore ac cite");
  });

  it("the CLI map's create_spec row names citation, not a parent", () => {
    const body = readFileSync(join(REPO_ROOT, "assets/skills/shared/lore-cli-map.md"), "utf8");
    const row = body.split("\n").find((l) => l.includes("`create_spec`"));
    expect(row).toBeDefined();
    expect(row).not.toMatch(/--parent/);
    expect(row).toMatch(/cite/);
  });
});
