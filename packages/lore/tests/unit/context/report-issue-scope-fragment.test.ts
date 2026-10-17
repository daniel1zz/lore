// @spawns packages/lore/src/index.ts
// @reads .claude/rules/lore-corpus-workflow-close.md
// @reads assets/context/**
/**
 * @spec_ref AC-ISCOPE-1 (BR-1153)
 *
 * The shipped CLOSE fragment scopes `lore report-issue` to defects of lore itself, one root cause per
 * report, and routes this repository's own upkeep to plan/task work. The repo's compiled rules file must
 * equal a fresh render of the fragment, and `lore fragments check` must exit 0.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
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
  const bullet = readFileSync(FRAGMENT, "utf8")
    .split("\n")
    .find((line) => line.startsWith("- ") && line.includes("lore report-issue"));
  if (bullet === undefined) throw new Error("report-issue bullet not found in fragment");
  return bullet;
}

describe("AC-ISCOPE-1 report-issue scoping in the CLOSE fragment", () => {
  it("AC-ISCOPE-1(a) bullet carries one-root-cause, repo-upkeep-to-plan/task, lore-defect-only", () => {
    const bullet = reportIssueBullet();
    expect(bullet).toContain("one root cause");
    expect(bullet).toMatch(/never bundled/i);
    expect(bullet).toMatch(/defect of lore itself/i);
    for (const upkeep of ["tests already red on the baseline", "stale ledgers", "oversized docs", "missing anchors"]) {
      expect(bullet).toContain(upkeep);
    }
    expect(bullet).toMatch(/plan\/task/);
  });

  it("AC-ISCOPE-1(b) compiled rules file is byte-identical to a fresh render of the fragment", async () => {
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

  it("AC-ISCOPE-1(c) lore fragments check exits exactly 0", () => {
    // Run this checkout's source, not an installed `lore` whose embedded assets may predate the fragment.
    const r = spawnSync("bun", [join(REPO_ROOT, "packages", "lore", "src", "index.ts"), "fragments", "check"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
  }, 60_000);
});
