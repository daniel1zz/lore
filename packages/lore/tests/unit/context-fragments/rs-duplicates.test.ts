import { describe, expect, it } from "vitest";
import {
  findDuplicateLines,
  type ReadingGroup,
} from "../../../src/service/context-fragments/duplicates.js";

const frag = (id: string, body: string) => ({
  frontmatter: { id },
  path: `.lore/fragments/${id}.md`,
  body,
});

describe("findDuplicateLines", () => {
  it("AC-RS-4: exact and whitespace-variant duplicates across two main fragments give 2 findings naming both paths", () => {
    const groups: ReadingGroup[] = [
      {
        group: "main",
        fragments: [
          frag("a", "# A\nUse the claim command first.\nRun   the  tests\n"),
          frag("b", "# B\nUse the claim command first.\nRun the tests\n"),
        ],
      },
    ];
    const findings = findDuplicateLines(groups);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.kind).sort()).toEqual(["exact", "whitespace"]);
    for (const f of findings) {
      expect(f.group).toBe("main");
      expect([f.first.path, f.second.path]).toEqual([
        ".lore/fragments/a.md",
        ".lore/fragments/b.md",
      ]);
    }
    expect(findings.map((f) => f.line).sort()).toEqual(["Run the tests", "Use the claim command first."]);
  });

  it("AC-RS-4: same line repeated within one fragment, headings, blank lines, fences, rules, managed comment give 0 findings", () => {
    const groups: ReadingGroup[] = [
      {
        group: "main",
        fragments: [
          frag("a", "# Title\n\nrepeat me\nrepeat me\n```\n---\n<!-- lore:managed abc -->\n"),
          frag("b", "# Title\n\n\n```\n---\n<!-- lore:managed abc -->\n  ## Title\n"),
        ],
      },
    ];
    expect(findDuplicateLines(groups)).toHaveLength(0);
  });

  it("AC-RS-4: a line shared only by a lore-reviewer fragment and a tester fragment gives 0 findings", () => {
    const groups: ReadingGroup[] = [
      { group: "subagent:lore-reviewer", fragments: [frag("r", "shared line\n")] },
      { group: "subagent:tester", fragments: [frag("t", "shared line\n")] },
      { group: "main", fragments: [frag("m", "other\n")] },
    ];
    expect(findDuplicateLines(groups)).toHaveLength(0);
  });

  it("is deterministic regardless of input order", () => {
    const g = (order: number[]): ReadingGroup[] => {
      const fs = [frag("c", "x y\nq\n"), frag("a", "x y\nq\n"), frag("b", "x  y\n")];
      return [{ group: "main", fragments: order.map((i) => fs[i]!) }];
    };
    const forward = findDuplicateLines(g([0, 1, 2]));
    expect(forward.length).toBeGreaterThan(0);
    expect(forward).toEqual(findDuplicateLines(g([2, 1, 0])));
  });
});
