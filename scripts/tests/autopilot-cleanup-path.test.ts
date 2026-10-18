// @reads assets/skills/lore-autopilot/SKILL.md
// @reads assets/context/worktree-dispatch.md
/**
 * CL-4: the shipped orchestrator guidance trusts `lore done` to remove a merged agent worktree and sweeps at round end,
 * instead of telling the orchestrator to run `git worktree remove` by hand after the merge.
 * Six dimensions: HAPPY (SKILL.md names the sweep, no manual removal) / NEGATIVE (a manual `git worktree remove` line is
 * reported as `<file>:<line>`) / BOUNDARY (a prohibition line mentioning the command is not an instruction) /
 * ERROR (missing file fails loud) / STATE (`kept` reason is followed) / REGRESSION (the dispatch rule fragment agrees).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const SKILL = "assets/skills/lore-autopilot/SKILL.md";
const SHIPPED = [SKILL, "assets/context/worktree-dispatch.md"] as const;

/** Lines that instruct running `git worktree remove` (a line that forbids it, e.g. "never ... --force", is not an instruction). */
function manualRemovalLines(rel: string, text: string): string[] {
  return text
    .split("\n")
    .flatMap((line, i) => {
      const sentences = line.split(/(?<=[.;])\s+/);
      const instructs = sentences.some((s) => /git worktree remove/.test(s) && !/never|do not|don't/i.test(s));
      return instructs ? [`${rel}:${i + 1}`] : [];
    });
}

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

describe("autopilot cleanup path (CL-4)", () => {
  it("HAPPY/REGRESSION: no shipped post-merge guidance instructs a manual `git worktree remove`", () => {
    const hits = SHIPPED.flatMap((rel) => manualRemovalLines(rel, read(rel)));
    expect(hits, `manual post-merge removal still instructed at ${hits.join(", ")}`).toEqual([]);
  });

  it("HAPPY: SKILL.md names `lore worktree sweep --apply` at round end", () => {
    expect(read(SKILL)).toMatch(/round end[^\n]*`lore worktree sweep --apply`|`lore worktree sweep --apply`[^\n]*round end/i);
  });

  it("STATE: SKILL.md tells the orchestrator to read lore done's worktree line and follow a `kept` reason", () => {
    const text = read(SKILL);
    expect(text).toMatch(/worktree: removed/);
    expect(text).toMatch(/kept <path>: <reason>/);
  });

  it("NEGATIVE: the detector names file:line for an instruction", () => {
    expect(manualRemovalLines("X.md", "a\nthen `git worktree remove <path>` now")).toEqual(["X.md:2"]);
  });

  it("BOUNDARY: a prohibition line is not an instruction", () => {
    expect(manualRemovalLines("X.md", "never run `git worktree remove --force`")).toEqual([]);
  });

  it("ERROR: a missing shipped file throws", () => {
    expect(() => read("assets/context/autopilot-cleanup-path-missing.md")).toThrow(/ENOENT/);
  });
});
