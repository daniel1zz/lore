// @spawns packages/lore/src/index.ts
// @reads .claude/rules/lore-corpus-workflow-close.md
// @reads assets/context/**
// @reads CLAUDE.md
/**
 * @spec_ref AC-IGH-1, AC-IGH-2 (BR-1153; spec-issues-state-problems-on-github-tasks-state-execution)
 *
 * Issues state problems, tasks state execution: the shipped CLOSE fragment's report-issue bullet and the root
 * CLAUDE.md Dogfooding section both say a problem not fixed in place is filed as an issue (also in lore's own
 * repository), a task names the issues it resolves, and never a task whose subject is the problem.
 *
 * Locators: the "report-issue bullet" is the single fragment line starting with "- " that contains
 * "lore report-issue"; the "Dogfooding section" runs from the line "## Dogfooding" up to (not including) the
 * next line starting with "## " or "# ".
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InMemoryFsPort } from "@lore/core";
import { runContextRefresh } from "../../../src/flows/context-flow.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const SHIPPED_DIR = join(REPO_ROOT, "assets", "context");
const FRAGMENT = join(SHIPPED_DIR, "corpus-workflow-4-close.md");
const COMPILED_REL = ".claude/rules/lore-corpus-workflow-close.md";

function reportIssueBullet(): string {
  const matches = readFileSync(FRAGMENT, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("- ") && line.includes("lore report-issue"));
  expect(matches).toHaveLength(1);
  return matches[0] as string;
}

function dogfoodingSection(): string {
  const lines = readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8").split("\n");
  const start = lines.indexOf("## Dogfooding");
  expect(start).toBeGreaterThanOrEqual(0);
  let end = lines.findIndex((l, i) => i > start && (l.startsWith("## ") || l.startsWith("# ")));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join("\n");
}

describe("AC-IGH-1 report-issue bullet in the CLOSE fragment", () => {
  it("AC-IGH-1(a) bullet carries the issues-state-problems wording and drops the old plan/task routing", () => {
    const bullet = reportIssueBullet();
    for (const phrase of [
      "one root cause",
      "file it as an issue",
      "including in the tool's own repository",
      "a task names the issues it resolves",
      "never a task whose subject is the problem",
    ]) {
      expect(bullet).toContain(phrase);
    }
    expect(bullet).not.toContain("plan/task work");
    expect(bullet).not.toContain("not a report");
  });

  it("AC-IGH-1(b) compiled rules file is byte-identical to a fresh render of the fragment", async () => {
    const files: Record<string, string> = {};
    for (const name of readdirSync(SHIPPED_DIR).filter((n) => n.endsWith(".md"))) {
      files[`assets/context/${name}`] = readFileSync(join(SHIPPED_DIR, name), "utf8");
    }
    const fs = new InMemoryFsPort(files);
    const result = await runContextRefresh(
      {
        fs,
        assetsRoot: "assets",
        home: "/home/test",
        xdgConfigHome: "/home/test/.config",
        globalConfig: {},
        projectConfig: {},
      },
      "",
      { scope: "project", rulesOnly: true },
    );
    expect(result.ok).toBe(true);
    const fresh = await fs.readFile(COMPILED_REL);
    expect(fresh).not.toBeNull();
    expect(readFileSync(join(REPO_ROOT, COMPILED_REL), "utf8")).toBe(fresh);
  });

  it("AC-IGH-1(c) lore fragments check exits exactly 0", () => {
    // Run this checkout's source, not an installed `lore` whose embedded assets may predate the fragment.
    // cwd is a throwaway directory: the test sandbox refuses the repository's own corpus, and `fragments check`
    // validates the shipped assets (embedded in the source), not the cwd's corpus.
    const cwd = mkdtempSync(join(tmpdir(), "igh-fragments-check-"));
    try {
      const r = spawnSync("bun", [join(REPO_ROOT, "packages", "lore", "src", "index.ts"), "fragments", "check"], {
        cwd,
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("AC-IGH-2 root CLAUDE.md Dogfooding section", () => {
  it("AC-IGH-2 section says file-as-issue and task-names-issues, and no longer forbids report-issue", () => {
    const section = dogfoodingSection();
    expect(section).toContain("file it as an issue");
    expect(section).toContain("a task names the issues it resolves");
    expect(section).not.toMatch(/Never `lore report-issue`/);
  });
});
